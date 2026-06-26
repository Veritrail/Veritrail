from __future__ import annotations

import traceback
import uuid
from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import func, select

from app.checks.persist import persist_findings
from app.checks.registry import ALL_CHECKS
from app.checks import role_unused_services
from app.collectors.account_governance import collect_account_governance
from app.collectors.iam import collect_iam
from app.collectors.iam_server_certificates import collect_iam_server_certificates
from app.collectors.last_accessed import collect_perm_usage
from app.collectors.account import collect_s3, collect_s3_account_public_access_block, collect_kms
from app.collectors.cloudtrail import collect_cloudtrail
from app.collectors.cloudtrail_events import collect_cloudtrail_events
from app.collectors.backup import collect_backup
from app.collectors.guardduty import collect_guardduty
from app.collectors.guardduty_findings import collect_guardduty_findings
from app.collectors.identity_center import collect_identity_center
from app.collectors.config_compliance import collect_config_compliance
from app.collectors.vpc import collect_vpc
from app.collectors.rds import collect_rds
from app.collectors.eks import collect_eks
from app.collectors.ecs import collect_ecs
from app.collectors.ecr_registry import collect_ecr_registry_settings
from app.collectors.inspector import collect_inspector
from app.collectors.ec2 import collect_ec2
from app.collectors.extended import (
    collect_acm,
    collect_dynamodb,
    collect_ecr,
    collect_elb,
    collect_lambda,
    collect_secrets,
    collect_sns,
    collect_sqs,
    collect_ssm_parameters,
)
from app.collectors.access_analyzer import collect_access_analyzer
from app.collectors.config_service import collect_config_service
from app.collectors.securityhub import collect_securityhub
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models import AssumeRoleAudit, AwsAccount, ScanRun, EvidenceSnapshot, Finding
from app.models.org import Org, User
from app.worker.celery_app import celery_app

# maps check_id prefix → collector function(db, acc)
# More-specific prefixes must come before less-specific ones
_COLLECTOR_FOR_CHECK = {
    "iam.server_certificate.": lambda db, acc: collect_iam_server_certificates(db, acc),
    "iam.": lambda db, acc: collect_iam(db, acc),
    "aws.account.": lambda db, acc: collect_account_governance(db, acc),
    "s3.account.": lambda db, acc: collect_s3_account_public_access_block(db, acc),
    "s3.": lambda db, acc: collect_s3(db, acc),
    "kms.": lambda db, acc: collect_kms(db, acc),
    "cloudtrail.": lambda db, acc: collect_cloudtrail(db, acc),
    "guardduty.": lambda db, acc: collect_guardduty(db, acc),
    "aws.identity": lambda db, acc: collect_identity_center(db, acc),
    "identity_center.user.": lambda db, acc: collect_identity_center(db, acc),
    "aws.access_analyzer.": lambda db, acc: collect_access_analyzer(db, acc),
    "aws.config.": lambda db, acc: collect_config_service(db, acc),
    "aws.securityhub.": lambda db, acc: collect_securityhub(db, acc),
    "vpc.": lambda db, acc: collect_vpc(db, acc),
    "ec2.ami.": lambda db, acc: collect_ec2(db, acc),
    "ec2.security_group.": lambda db, acc: collect_vpc(db, acc),
    "ec2.instance.": lambda db, acc: collect_ec2(db, acc),
    "ec2.ebs.": lambda db, acc: collect_ec2(db, acc),
    "acm.": lambda db, acc: collect_acm(db, acc),
    "lambda.": lambda db, acc: collect_lambda(db, acc),
    "secretsmanager.": lambda db, acc: collect_secrets(db, acc),
    "ssm.": lambda db, acc: collect_ssm_parameters(db, acc),
    "elb.": lambda db, acc: collect_elb(db, acc),
    "dynamodb.": lambda db, acc: collect_dynamodb(db, acc),
    "ecr.": lambda db, acc: collect_ecr(db, acc),
    "eks.": lambda db, acc: collect_eks(db, acc),
    "ecs.": lambda db, acc: collect_ecs(db, acc),
    "aws.inspector.": lambda db, acc: collect_inspector(db, acc),
    "aws.vulnerability_monitoring.": lambda db, acc: collect_inspector(db, acc),
    "sns.": lambda db, acc: collect_sns(db, acc),
    "sqs.": lambda db, acc: collect_sqs(db, acc),
    "rds.": lambda db, acc: collect_rds(db, acc),
}

_CHECK_BY_ID = {mod.CHECK_ID: mod for mod in ALL_CHECKS}

log = structlog.get_logger()


def _enqueue_post_scan_tasks(account_id: str) -> None:
    """Queue non-critical follow-up work without changing scan outcome."""
    try:
        collect_perm_usage_task.delay(account_id)
    except Exception:  # noqa: BLE001
        log.exception("scan.followup_enqueue_failed", account_id=account_id, task="collect_perm_usage")

    try:
        check_integration_health_task.delay(account_id)
    except Exception:  # noqa: BLE001
        log.exception("scan.followup_enqueue_failed", account_id=account_id, task="check_integration_health")

    settings = get_settings()
    if not settings.AI_TRIAGE_ENABLED:
        return
    try:
        ai_triage_task.delay(account_id)
    except Exception:  # noqa: BLE001
        log.exception("scan.followup_enqueue_failed", account_id=account_id, task="ai_triage")



@celery_app.task(
    name="app.worker.tasks.run_scan",
    soft_time_limit=900,  # 15 min
    time_limit=1200,      # 20 min hard kill
)
def run_scan(account_id: str) -> dict:
    """Run a full scan for the given AwsAccount using the ScanPipeline."""
    db = SessionLocal()
    step = "bootstrap"
    run: ScanRun | None = None
    acc: AwsAccount | None = None
    try:
        try:
            acc_uuid = uuid.UUID(account_id)
        except ValueError:
            log.warning("scan.bad_account_id", account_id=account_id)
            db.close()
            return {"ok": False, "error": "invalid account id"}

        acc = db.get(AwsAccount, acc_uuid)
        if not acc:
            log.warning("scan.account_not_found", account_id=account_id)
            db.close()
            return {"ok": False, "error": "account not found"}

        run = ScanRun(id=uuid.uuid4(), account_id=acc.id, status="running")
        db.add(run)
        db.commit()
    except Exception:
        log.exception("scan.bootstrap_failed", account_id=account_id, step=step)
        db.close()
        raise

    try:
        from app.worker.scan_pipeline import ScanPipeline

        pipeline = ScanPipeline(db, acc, run)
        collectors = [
            ("collect_iam", collect_iam),
            ("collect_account_governance", collect_account_governance),
            ("collect_iam_server_certificates", collect_iam_server_certificates),
            ("collect_s3_public_access_block", collect_s3_account_public_access_block),
            ("collect_s3", collect_s3),
            ("collect_kms", collect_kms),
            ("collect_cloudtrail", collect_cloudtrail),
            ("collect_cloudtrail_events", collect_cloudtrail_events),
            ("collect_vpc", collect_vpc),
            ("collect_backup", collect_backup),
            ("collect_guardduty", collect_guardduty),
            ("collect_guardduty_findings", collect_guardduty_findings),
            ("collect_identity_center", collect_identity_center),
            ("collect_rds", collect_rds),
            ("collect_ec2", collect_ec2),
            ("collect_acm", collect_acm),
            ("collect_lambda", collect_lambda),
            ("collect_secrets", collect_secrets),
            ("collect_ssm_parameters", collect_ssm_parameters),
            ("collect_elb", collect_elb),
            ("collect_dynamodb", collect_dynamodb),
            ("collect_ecr", collect_ecr),
            ("collect_ecr_registry_settings", collect_ecr_registry_settings),
            ("collect_eks", collect_eks),
            ("collect_ecs", collect_ecs),
            ("collect_inspector", collect_inspector),
            ("collect_sns", collect_sns),
            ("collect_sqs", collect_sqs),
            ("collect_access_analyzer", collect_access_analyzer),
            ("collect_config_service", collect_config_service),
            ("collect_config_compliance", collect_config_compliance),
            ("collect_securityhub", collect_securityhub),
        ]

        result = pipeline.execute(collectors)

        if result.ok:
            _enqueue_post_scan_tasks(account_id)
            try:
                from app.services.scan_alert import notify_new_findings
                notify_new_findings(db, acc.id, run.id)
            except Exception:
                log.exception("scan.new_findings_notify_failed", account_id=str(acc.id))
            return {
                "ok": True,
                "opened": result.opened,
                "resolved": result.resolved,
                "snapshots": result.snapshots,
            }
        else:
            return {"ok": False, "error": result.error or "unknown", "step": result.step}
    except Exception as e:
        db.rollback()
        tb = traceback.format_exc()
        try:
            run = db.get(ScanRun, run.id) if run is not None else None
        except Exception:
            run = None
        error_persisted = False
        if run is not None:
            run.status = "error"
            run.finished_at = datetime.now(timezone.utc)
            run.error = (f"{type(e).__name__} during {step}: {e}\n\n{tb}")[:1990]
            existing = run.stats or {}
            run.stats = existing | {
                "failed_at": step,
                "error_type": type(e).__name__,
            }
            try:
                db.commit()
                error_persisted = True
            except Exception:
                db.rollback()
                log.exception("scan.error_persist_failed", account_id=str(acc.id) if acc else None)
        log.exception(
            "scan.failed",
            account_id=str(acc.id) if acc else None,
            step=step,
            error_type=type(e).__name__,
        )
        if error_persisted and run is not None and acc is not None:
            try:
                from app.services.scan_alert import notify_scan_failure
                notify_scan_failure(db, acc.id, run.id)
            except Exception:
                log.exception("scan.failure_notify_failed", account_id=str(acc.id))
        return {"ok": False, "error": str(e), "step": step}
    finally:
        db.close()

@celery_app.task(name="app.worker.tasks.collect_perm_usage_task")
def collect_perm_usage_task(account_id: str) -> dict:
    """Background task: collect service last-accessed per role, then re-run unused_services check."""
    db = SessionLocal()
    try:
        acc = db.get(AwsAccount, uuid.UUID(account_id))
        if not acc:
            return {"error": "account not found"}

        count = collect_perm_usage(db, acc)

        drafts = role_unused_services.run(db, acc.id)
        if drafts:
            persist_findings(
                db,
                org_id=acc.org_id,
                account_id=acc.id,
                drafts=drafts,
                check_ids_run={role_unused_services.CHECK_ID},
            )

        log.info("perm_usage.complete", account_id=account_id, upserted=count, findings=len(drafts))
        return {"ok": True, "upserted": count, "findings": len(drafts)}
    except Exception as e:  # noqa: BLE001
        db.rollback()
        log.exception("perm_usage.failed", account_id=account_id)
        return {"ok": False, "error": str(e)}
    finally:
        db.close()


@celery_app.task(name="app.worker.tasks.check_integration_health_task")
def check_integration_health_task(account_id: str) -> dict:
    """Background task: refresh OAuth/API connection status for org integrations."""
    from app.services.integration_health import check_org_integration_health_for_account

    db = SessionLocal()
    try:
        results = check_org_integration_health_for_account(db, uuid.UUID(account_id))
        if results is None:
            return {"error": "account not found"}
        log.info("integration.health.complete", account_id=account_id, results=results)
        return {"ok": True, "results": results}
    except Exception as e:  # noqa: BLE001
        db.rollback()
        log.exception("integration.health.failed", account_id=account_id)
        return {"ok": False, "error": str(e)}
    finally:
        db.close()


@celery_app.task(name="app.worker.tasks.recheck_finding")
def recheck_finding(account_id: str, check_id: str) -> dict:
    """Re-collect only what's needed for check_id, then rerun that check."""
    db = SessionLocal()
    try:
        acc = db.get(AwsAccount, uuid.UUID(account_id))
        if not acc:
            return {"error": "account not found"}

        collector = next(
            (fn for prefix, fn in _COLLECTOR_FOR_CHECK.items() if check_id.startswith(prefix)),
            None,
        )
        if collector:
            collector(db, acc)

        mod = _CHECK_BY_ID.get(check_id)
        if not mod:
            return {"error": f"unknown check: {check_id}"}

        drafts = mod.run(db, acc.id)
        opened, resolved = persist_findings(
            db,
            org_id=acc.org_id,
            account_id=acc.id,
            drafts=drafts,
            check_ids_run={check_id},
        )
        log.info("recheck.complete", account_id=account_id, check_id=check_id, opened=opened, resolved=resolved)
        return {"ok": True, "opened": opened, "resolved": resolved}
    except Exception as e:  # noqa: BLE001
        db.rollback()
        log.exception("recheck.failed", account_id=account_id, check_id=check_id)
        return {"ok": False, "error": str(e)}
    finally:
        db.close()


@celery_app.task(name="app.worker.tasks.scan_all_accounts")
def scan_all_accounts() -> dict:
    """Queue scans for connected accounts whose org schedule says they're due."""
    from app.services.scan_schedule import get_scanning_settings, should_queue_automated_scan

    db = SessionLocal()
    queued = 0
    skipped = 0
    try:
        accounts = db.scalars(select(AwsAccount).where(AwsAccount.status == "connected")).all()
        now = datetime.now(timezone.utc)
        for acc in accounts:
            org = db.get(Org, acc.org_id)
            if not org:
                skipped += 1
                continue
            scanning = get_scanning_settings(org.settings or {})
            if not should_queue_automated_scan(acc, scanning, db, now):
                skipped += 1
                continue
            run_scan.delay(str(acc.id))
            queued += 1
        return {"queued": queued, "skipped": skipped}
    finally:
        db.close()


@celery_app.task(name="app.worker.tasks.reap_stuck_scan_runs")
def reap_stuck_scan_runs(max_age_minutes: int = 30) -> dict:
    """Mark ScanRuns stuck in 'running' as failed.

    Called on worker startup with max_age_minutes=0 (any in-flight scan from a
    prior process is dead) and periodically with the default to catch scans
    that hang silently (network stall, OOM, etc.)."""
    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=max_age_minutes)
        stale = db.scalars(
            select(ScanRun)
            .where(ScanRun.status == "running")
            .where(ScanRun.started_at < cutoff)
        ).all()
        now = datetime.now(timezone.utc)
        for run in stale:
            run.status = "error"
            run.finished_at = now
            run.error = "scan interrupted (worker restart or timeout)"
        if stale:
            db.commit()
            log.info("reap_stuck_scan_runs", count=len(stale), max_age_minutes=max_age_minutes)
        return {"reaped": len(stale)}
    finally:
        db.close()


@celery_app.task(name="app.worker.tasks.prune_assume_role_audit")
def prune_assume_role_audit(retention_days: int = 365) -> dict:
    """Delete assume_role_audit rows older than `retention_days` (default 1 year).

    Customer-facing audit log doesn't need to live forever — most disputes
    are resolved within weeks. 1y retention keeps the table small and is
    long enough for any reasonable SOC2 evidence window.
    """
    from sqlalchemy import delete as sql_delete

    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        result = db.execute(
            sql_delete(AssumeRoleAudit).where(AssumeRoleAudit.called_at < cutoff)
        )
        deleted = result.rowcount or 0
        db.commit()
        if deleted:
            log.info("prune_assume_role_audit", deleted=deleted, retention_days=retention_days)
        return {"deleted": deleted, "retention_days": retention_days}
    except Exception:  # noqa: BLE001
        db.rollback()
        log.exception("prune_assume_role_audit.failed")
        return {"ok": False, "deleted": 0}
    finally:
        db.close()


@celery_app.task(name="app.worker.tasks.expire_evidence_artifacts")
def expire_evidence_artifacts() -> dict:
    """Mark expired external evidence and optionally purge old rejected/expired rows."""
    from app.services.evidence_artifact_retention import run_evidence_artifact_retention

    db = SessionLocal()
    try:
        result = run_evidence_artifact_retention(db)
        if result["expired_status"] or result["purged"]:
            log.info("expire_evidence_artifacts", **result)
        return result
    except Exception:  # noqa: BLE001
        db.rollback()
        log.exception("expire_evidence_artifacts.failed")
        return {"ok": False, "expired_status": 0, "purged": 0}
    finally:
        db.close()


@celery_app.task(name="app.worker.tasks.notify_evidence_renewals")
def notify_evidence_renewals() -> dict:
    """Email org admins/editors about expiring or stale external evidence."""
    from app.services.evidence_renewal_reminders import notify_all_orgs_evidence_renewals

    db = SessionLocal()
    try:
        result = notify_all_orgs_evidence_renewals(db)
        if result["sent"]:
            log.info("notify_evidence_renewals", **result)
        return result
    except Exception:  # noqa: BLE001
        db.rollback()
        log.exception("notify_evidence_renewals.failed")
        return {"ok": False, "sent": 0, "skipped": 0}
    finally:
        db.close()


@celery_app.task(name="app.worker.tasks.send_weekly_digests")
def send_weekly_digests() -> dict:
    """Send Monday digest to all org members with a connected account."""
    from app.services.digest import send_digest

    db = SessionLocal()
    sent = 0
    skipped = 0
    try:
        orgs = db.scalars(select(Org)).all()
        since = datetime.now(timezone.utc) - timedelta(days=7)

        for org in orgs:
            org_settings = org.settings or {}
            notifications = org_settings.get("notifications", {})
            email_digest = notifications.get("email_digest_enabled", False)
            slack_digest = notifications.get("slack_digest_enabled", False)
            slack_url = notifications.get("slack_webhook_url")
            if not email_digest and not (slack_digest and slack_url):
                skipped += 1
                continue

            acc = db.scalars(
                select(AwsAccount).where(
                    AwsAccount.org_id == org.id,
                    AwsAccount.status == "connected",
                )
            ).first()
            if not acc:
                skipped += 1
                continue

            from app.services.check_settings import hidden_check_ids

            org_settings = org.settings or {}
            hidden = hidden_check_ids(org_settings)

            open_q = select(Finding).where(
                Finding.account_id == acc.id,
                Finding.status == "open",
            )
            if hidden:
                open_q = open_q.where(Finding.check_id.notin_(hidden))
            open_findings = db.scalars(open_q.order_by(Finding.risk_score.desc())).all()

            new_q = select(Finding).where(
                Finding.account_id == acc.id,
                Finding.first_seen >= since,
            )
            if hidden:
                new_q = new_q.where(Finding.check_id.notin_(hidden))
            new_this_week = db.scalars(new_q).all()

            from sqlalchemy import func as sa_func
            resolved_count = db.scalar(
                select(sa_func.count()).select_from(
                    select(Finding).where(
                        Finding.account_id == acc.id,
                        Finding.status == "resolved",
                        Finding.last_seen >= since,
                    ).subquery()
                )
            ) or 0

            findings_dicts = [
                {
                    "title": f.title,
                    "severity": f.severity,
                    "risk_score": f.risk_score,
                    "resource_arn": f.resource_arn,
                    "check_id": f.check_id,
                }
                for f in open_findings
            ]
            new_dicts = [
                {"title": f.title, "severity": f.severity}
                for f in new_this_week
            ]

            from app.services.digest_tokens import persist_digest_unsubscribe_token

            unsubscribe_token = persist_digest_unsubscribe_token(db, org)

            # ── Rich-digest extras: per-day trend, coverage, last-week deltas ──
            from app.models.digest_snapshot import DigestSnapshot
            from app.services.digest_data import gather_digest_extras

            per_day, coverage, prev = gather_digest_extras(
                db, org_id=org.id, account_id=acc.id, since=since
            )

            digest_email = org_settings.get("notifications", {}).get("digest_email")
            if digest_email:
                recipients = [digest_email]
            else:
                recipients = [
                    u.email
                    for u in db.scalars(select(User).where(User.org_id == org.id)).all()
                    if u.email
                ]

            for email in recipients:
                if not email_digest:
                    break
                ok = send_digest(
                    to=email,
                    org_name=org.name if hasattr(org, "name") else str(org.id),
                    account_label=acc.label,
                    open_findings=findings_dicts,
                    new_this_week=new_dicts,
                    resolved_this_week=resolved_count,
                    unsubscribe_token=unsubscribe_token,
                    per_day=per_day,
                    coverage=coverage,
                    prev=prev,
                )
                if ok:
                    sent += 1

            slack_url = org_settings.get("notifications", {}).get("slack_webhook_url")
            if slack_digest and slack_url:
                try:
                    import httpx as _httpx
                    from app.services.digest import build_digest_slack_blocks
                    fallback, blocks = build_digest_slack_blocks(
                        account_label=acc.label,
                        open_findings=findings_dicts,
                        new_this_week=new_dicts,
                        resolved_this_week=resolved_count,
                    )
                    _httpx.post(slack_url, json={"text": fallback, "blocks": blocks}, timeout=10)
                except Exception:  # noqa: BLE001
                    pass

            # Snapshot this week's headline numbers so next week can show deltas.
            try:
                from app.services.digest import _posture_score, _severity_counts

                snap_counts = _severity_counts(findings_dicts)
                db.add(
                    DigestSnapshot(
                        org_id=org.id,
                        open_count=len(findings_dicts),
                        new_count=len(new_dicts),
                        resolved_count=resolved_count,
                        posture_score=_posture_score(snap_counts),
                        critical_count=snap_counts["critical"],
                        high_count=snap_counts["high"],
                        medium_count=snap_counts["medium"],
                        low_count=snap_counts["low"],
                    )
                )
                db.commit()
            except Exception:  # noqa: BLE001
                db.rollback()
                log.warning("digest.snapshot_failed", org_id=str(org.id), exc_info=True)

        log.info("digests.complete", sent=sent, skipped=skipped)
        return {"sent": sent, "skipped": skipped}
    except Exception as e:  # noqa: BLE001
        log.exception("digests.failed")
        return {"ok": False, "error": str(e)}
    finally:
        db.close()


@celery_app.task(
    name="app.worker.tasks.ai_triage_task",
    soft_time_limit=120,  # 2 min — LLM calls should be fast
    time_limit=180,       # 3 min hard kill
)
def ai_triage_task(account_id: str) -> dict:
    """Run AI triage on new/updated findings for an account after a scan.

    Gathers context for each finding (finding details + evidence snapshots +
    account info + recent history of the same check), sends it to the LLM,
    and stores the result in ai_triage_results.

    Runs fire-and-forget — failures are logged but never block the scan.
    """
    from app.core.config import get_settings as _settings

    from app.services.ai_finding_review import llm_triage_available

    settings = _settings()
    use_llm = llm_triage_available()

    db = SessionLocal()
    triaged = 0
    try:
        acc_uuid = uuid.UUID(account_id)
        acc = db.get(AwsAccount, acc_uuid)
        if not acc:
            return {"ok": False, "error": "account not found"}

        from app.models.org import Org
        from app.services.ai_finding_review import org_ai_finding_review_enabled

        org = db.get(Org, acc.org_id)
        if not org_ai_finding_review_enabled(org):
            return {"ok": True, "triaged": 0, "reason": "org_disabled"}

        # Gather findings that are open (haven't been resolved/ignored yet)
        from sqlalchemy import select as sa_select

        open_findings = db.scalars(
            sa_select(Finding).where(
                Finding.account_id == acc_uuid,
                Finding.status.in_(("open", "snoozed")),
            )
        ).all()

        if not open_findings:
            return {"ok": True, "triaged": 0}

        from app.models.ai_triage import AITriageResult
        from app.services.ai_finding_review import apply_heuristic_triage
        from app.services.ai_triage import call_llm_for_triage

        model_ver = settings.AI_TRIAGE_MODEL

        for finding in open_findings:
            # Check if already triaged recently (within last 24h)
            from datetime import timedelta
            existing = db.scalars(
                sa_select(AITriageResult)
                .where(
                    AITriageResult.finding_id == finding.id,
                    AITriageResult.created_at >= func.now() - timedelta(hours=24),
                )
                .order_by(AITriageResult.created_at.desc())
                .limit(1)
            ).first()
            if existing:
                continue  # already triaged recently

            # Build context for the LLM
            evidence_snaps = db.scalars(
                sa_select(EvidenceSnapshot).where(
                    EvidenceSnapshot.account_id == acc_uuid,
                ).order_by(EvidenceSnapshot.ts.desc()).limit(20)
            ).all()

            # Recent history of same check
            history_count = db.scalar(
                sa_select(func.count()).select_from(
                    sa_select(Finding).where(
                        Finding.account_id == acc_uuid,
                        Finding.check_id == finding.check_id,
                    ).subquery()
                )
            ) or 0

            # Resolved count for the same check
            resolved_same_check = db.scalar(
                sa_select(func.count()).select_from(
                    sa_select(Finding).where(
                        Finding.account_id == acc_uuid,
                        Finding.check_id == finding.check_id,
                        Finding.status == "resolved",
                    ).subquery()
                )
            ) or 0

            finding_context = {
                "finding": {
                    "check_id": finding.check_id,
                    "title": finding.title,
                    "severity": finding.severity,
                    "risk_score": finding.risk_score,
                    "status": finding.status,
                    "resource_arn": finding.resource_arn,
                    "evidence": finding.evidence,
                    "first_seen": finding.first_seen.isoformat() if finding.first_seen else None,
                    "last_seen": finding.last_seen.isoformat() if finding.last_seen else None,
                },
                "account": {
                    "account_id": acc.account_id,
                    "label": acc.label,
                    "status": acc.status,
                    "last_scan_at": acc.last_scan_at.isoformat() if acc.last_scan_at else None,
                },
                "evidence_snapshots": [
                    {
                        "entity_type": s.entity_type,
                        "entity_id": s.entity_id,
                        "payload": s.payload_json,
                    }
                    for s in evidence_snaps
                ],
                "history": {
                    "total_findings_for_check": history_count,
                    "resolved_same_check": resolved_same_check,
                },
            }

            if use_llm:
                result = call_llm_for_triage(finding_context)
                if result is None:
                    apply_heuristic_triage(db, finding)
                    triaged += 1
                    continue
                triage_result = AITriageResult(
                    id=uuid.uuid4(),
                    finding_id=finding.id,
                    confidence_score=result.confidence_score,
                    rationale=result.rationale,
                    suggested_action=result.suggested_action,
                    findings_context=finding_context,
                    model_version=model_ver,
                )
                db.add(triage_result)
            else:
                apply_heuristic_triage(db, finding)
            triaged += 1

        db.commit()
        log.info("ai_triage.task_complete", account_id=account_id, triaged=triaged)
        return {"ok": True, "triaged": triaged}
    except Exception as e:  # noqa: BLE001
        db.rollback()
        log.exception("ai_triage.task_failed", account_id=account_id)
        return {"ok": False, "error": str(e), "triaged": triaged}
    finally:
        db.close()


@celery_app.task(
    name="app.worker.tasks.ai_triage_single_finding",
    soft_time_limit=60,
    time_limit=90,
)
def ai_triage_single_finding(finding_id: str) -> dict:
    """Run AI triage on a single finding (triggered by manual re-triage endpoint)."""
    from app.core.config import get_settings as _settings

    from app.services.ai_finding_review import apply_heuristic_triage, llm_triage_available, org_ai_finding_review_enabled

    settings = _settings()
    use_llm = llm_triage_available()

    db = SessionLocal()
    try:
        fid = uuid.UUID(finding_id)
        finding = db.get(Finding, fid)
        if not finding:
            return {"ok": False, "error": "finding not found"}

        from app.models.org import Org
        from app.models.ai_triage import AITriageResult
        from app.services.ai_triage import call_llm_for_triage

        org = db.get(Org, finding.org_id)
        if not org_ai_finding_review_enabled(org):
            return {"ok": True, "reason": "org_disabled"}

        if not use_llm:
            row = apply_heuristic_triage(db, finding)
            return {
                "ok": True,
                "review_mode": "local",
                "confidence_score": row.confidence_score,
                "rationale": row.rationale,
                "suggested_action": row.suggested_action,
            }

        evidence_snaps = db.scalars(
            select(EvidenceSnapshot).where(
                EvidenceSnapshot.account_id == finding.account_id,
            ).order_by(EvidenceSnapshot.ts.desc()).limit(20)
        ).all()

        history_count = db.scalar(
            select(func.count()).select_from(
                select(Finding).where(
                    Finding.account_id == finding.account_id,
                    Finding.check_id == finding.check_id,
                ).subquery()
            )
        ) or 0

        acc = db.get(AwsAccount, finding.account_id)

        finding_context = {
            "finding": {
                "check_id": finding.check_id,
                "title": finding.title,
                "severity": finding.severity,
                "risk_score": finding.risk_score,
                "status": finding.status,
                "resource_arn": finding.resource_arn,
                "evidence": finding.evidence,
                "first_seen": finding.first_seen.isoformat() if finding.first_seen else None,
                "last_seen": finding.last_seen.isoformat() if finding.last_seen else None,
            },
            "account": {
                "account_id": acc.account_id if acc else None,
                "label": acc.label if acc else None,
                "status": acc.status if acc else None,
            },
            "evidence_snapshots": [
                {"entity_type": s.entity_type, "entity_id": s.entity_id, "payload": s.payload_json}
                for s in evidence_snaps
            ],
            "history": {"total_findings_for_check": history_count},
        }

        result = call_llm_for_triage(finding_context)
        if result is None:
            row = apply_heuristic_triage(db, finding)
            return {
                "ok": True,
                "review_mode": "local",
                "confidence_score": row.confidence_score,
                "rationale": row.rationale,
                "suggested_action": row.suggested_action,
            }

        triage_result = AITriageResult(
            id=uuid.uuid4(),
            finding_id=finding.id,
            confidence_score=result.confidence_score,
            rationale=result.rationale,
            suggested_action=result.suggested_action,
            findings_context=finding_context,
            model_version=settings.AI_TRIAGE_MODEL,
        )
        db.add(triage_result)
        db.commit()

        log.info("ai_triage.single_complete", finding_id=finding_id)
        return {
            "ok": True,
            "confidence_score": result.confidence_score,
            "rationale": result.rationale,
            "suggested_action": result.suggested_action,
        }
    except Exception as e:  # noqa: BLE001
        db.rollback()
        log.exception("ai_triage.single_failed", finding_id=finding_id)
        return {"ok": False, "error": str(e)}
    finally:
        db.close()


@celery_app.task(name="app.worker.tasks.alert_stale_scans")
def alert_stale_scans() -> dict:
    """Hourly evidence-gap guard: alert when a connected account has not
    scanned within its configured interval (+ grace). See scan_alert."""
    from app.services.scan_alert import notify_stale_scans

    db = SessionLocal()
    try:
        sent = notify_stale_scans(db)
        return {"alerts_sent": sent}
    finally:
        db.close()


@celery_app.task(
    name="app.worker.tasks.run_gcp_scan",
    soft_time_limit=600,
    time_limit=900,
)
def run_gcp_scan(project_id: str) -> dict:
    """Run GCP baseline collectors and checks for a connected project."""
    from datetime import datetime, timezone

    from app.collectors.gcp.compute import collect_compute_instances
    from app.collectors.gcp.logging_audit import collect_logging_audit
    from app.checks import gcp_compute_instance_public_ip, gcp_logging_not_enabled
    from app.models.gcp_project import GcpProject
    from app.worker.cloud_scan import execute_cloud_scan

    db = SessionLocal()
    try:
        row = db.get(GcpProject, uuid.UUID(project_id))
        if not row:
            return {"ok": False, "error": "project not found"}

        def _on_success() -> None:
            row.status = "connected"
            row.last_scan_at = datetime.now(timezone.utc)
            row.last_error = None

        def _on_error(err: str) -> None:
            row.status = "error"
            row.last_error = err[:1000]

        result = execute_cloud_scan(
            db,
            org_id=row.org_id,
            scope_column="gcp_project_id",
            scope_id=row.id,
            collectors=[
                ("collect_logging_audit", collect_logging_audit),
                ("collect_compute_instances", collect_compute_instances),
            ],
            checks=[
                ("gcp_logging_not_enabled", gcp_logging_not_enabled.run),
                ("gcp_compute_instance_public_ip", gcp_compute_instance_public_ip.run),
            ],
            target=row,
            on_success=_on_success,
            on_error=_on_error,
        )
        return {
            "ok": result.ok,
            "opened": result.opened,
            "resolved": result.resolved,
            "error": result.error,
        }
    finally:
        db.close()


@celery_app.task(
    name="app.worker.tasks.run_azure_scan",
    soft_time_limit=600,
    time_limit=900,
)
def run_azure_scan(subscription_id: str) -> dict:
    """Run Azure baseline collectors and checks for a connected subscription."""
    from datetime import datetime, timezone

    from app.collectors.azure.defender import collect_defender
    from app.collectors.azure.storage import collect_storage_accounts
    from app.checks import azure_defender_not_enabled, azure_storage_public_blob_access
    from app.models.azure_subscription import AzureSubscription
    from app.worker.cloud_scan import execute_cloud_scan

    db = SessionLocal()
    try:
        row = db.get(AzureSubscription, uuid.UUID(subscription_id))
        if not row:
            return {"ok": False, "error": "subscription not found"}

        def _on_success() -> None:
            row.status = "connected"
            row.last_scan_at = datetime.now(timezone.utc)
            row.last_error = None

        def _on_error(err: str) -> None:
            row.status = "error"
            row.last_error = err[:1000]

        result = execute_cloud_scan(
            db,
            org_id=row.org_id,
            scope_column="azure_subscription_id",
            scope_id=row.id,
            collectors=[
                ("collect_defender", collect_defender),
                ("collect_storage_accounts", collect_storage_accounts),
            ],
            checks=[
                ("azure_defender_not_enabled", azure_defender_not_enabled.run),
                ("azure_storage_public_blob_access", azure_storage_public_blob_access.run),
            ],
            target=row,
            on_success=_on_success,
            on_error=_on_error,
        )
        return {
            "ok": result.ok,
            "opened": result.opened,
            "resolved": result.resolved,
            "error": result.error,
        }
    finally:
        db.close()
