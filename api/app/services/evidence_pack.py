"""Assemble a ZIP evidence pack for a given framework + account + time period."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import structlog
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Finding, FindingEvent, EvidenceSnapshot, ScanRun
from app.models.cloudtrail import CloudTrailEvent
from app.models.control import Control, CheckControl
from app.models.aws_account import AwsAccount
from app.models.org import Org
from app.services.check_coverage import control_coverage_tier, extended_checks_in_list, tier_for_check
from app.services.check_evidence import (
    all_evidence_classes,
    evidence_class_for_check,
    evidence_class_label,
)
from app.services.check_settings import hidden_check_ids
from app.services.cis_benchmark_coverage import cis_benchmark_coverage
from app.models.github import CiPipeline, IdentityProvider, IdentityUser, PullRequest, Repo, RepoProtection, WorkflowRun
from app.models.iam import IamUser
from app.models.resources import IdentityCenterUser
from app.services.access_review_summary import build_access_review_summary
from app.services.evidence_coverage import compute_evidence_coverage, period_bounds
from app.services.sdlc_evidence import build_sdlc_evidence
from app.services.finding_history import (
    STATE_EXCEPTED,
    STATE_OPEN,
    finding_open_for_control,
    findings_for_pack_at,
)
from app.services.control_audit_block import build_control_audit_block
from app.services.pack_provenance import build_pack_provenance
from app.services.pdf_report import build_pdf
from app.services.evidence_vault import (
    org_vault_override,
    plan_auditor_access,
    plan_vault_upload,
    upload_pack_to_vault,
    vault_enabled,
)
from app.services.github_sync import provider_config
from app.services.scanner_integrations import SCANNER_TYPES, public_config
from app.services.siem_integrations import SIEM_TYPES, public_config as siem_public_config

log = structlog.get_logger()

# Max snapshots embedded per control folder (full count in snapshots_total).
_SNAPSHOT_EMBED_LIMIT = 50
_CLOUDTRAIL_EVENT_LIMIT = 1000


@dataclass(frozen=True)
class EvidencePackResult:
    zip_bytes: bytes
    report_id: str
    vault_upload: dict[str, Any] | None = None


def _control_status(
    pack_findings: list[tuple[Finding, str]],
    check_ids: list[str],
) -> tuple[str, list[tuple[Finding, str]]]:
    """Return (pass|fail|at_risk|no_data, matching (finding, state_at_end) rows).

    Only benchmark-class checks in ``open`` state fail a control. Supporting and
    hygiene findings are exported but do not change pass/fail. ``excepted`` never
    fails. Mirrors control_status.compute_control_status: a control whose checks
    are all supporting/activity class reports at_risk (not a vacuous pass) when
    those signals have open findings.
    """
    if not check_ids:
        return "no_data", []
    hits = [(f, st) for f, st in pack_findings if f.check_id in check_ids]
    if any(finding_open_for_control(f, st) for f, st in hits):
        return "fail", hits
    from app.services.check_evidence import CLASS_ACTIVITY, CLASS_BENCHMARK, CLASS_SUPPORTING

    if not any(evidence_class_for_check(cid) == CLASS_BENCHMARK for cid in check_ids):
        supporting_open = [
            (f, st)
            for f, st in hits
            if st == STATE_OPEN
            and evidence_class_for_check(f.check_id) in (CLASS_SUPPORTING, CLASS_ACTIVITY)
        ]
        if supporting_open:
            return "at_risk", hits
    return "pass", hits


def build_evidence_pack(
    db: Session,
    org_id: uuid.UUID,
    account_id: uuid.UUID,
    framework: str,
    period_days: int = 90,
    as_of: datetime | None = None,
) -> EvidencePackResult:
    acc = db.get(AwsAccount, account_id)
    if not acc or str(acc.org_id) != str(org_id):
        raise ValueError("account not found")

    end = as_of if as_of else datetime.now(timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    since, period_end = period_bounds(end, period_days)
    coverage = compute_evidence_coverage(db, account_id, since, period_end, period_days)

    controls = db.scalars(
        select(Control).where(Control.framework == framework).order_by(Control.control_id)
    ).all()

    from app.services.seed_controls import effective_checks_for_control_row
    from app.services.org_control_mappings import load_org_mapping_index

    mapping_index = load_org_mapping_index(db, org_id)

    check_map: dict[uuid.UUID, list[str]] = {}
    for c in controls:
        links = db.scalars(
            select(CheckControl.check_id).where(CheckControl.control_id == c.id)
        ).all()
        check_map[c.id] = effective_checks_for_control_row(
            db, org_id, c, list(links), mapping_index=mapping_index
        )

    org = db.get(Org, org_id)
    hidden = hidden_check_ids(org.settings if org else {})
    pack_findings = findings_for_pack_at(
        db, account_id, end, hidden_check_ids=set(hidden)
    )

    snapshots = db.scalars(
        select(EvidenceSnapshot).where(
            EvidenceSnapshot.account_id == account_id,
            EvidenceSnapshot.taken_at >= since,
            EvidenceSnapshot.taken_at <= end,
        ).order_by(EvidenceSnapshot.taken_at.desc())
    ).all()

    generated_at = end

    snap_by_type: dict[str, list[dict[str, Any]]] = {}
    for s in snapshots:
        snap_by_type.setdefault(s.entity_type, []).append(
            {"entity_id": s.entity_id, "taken_at": s.taken_at.isoformat(), "data": s.payload_json}
        )

    # Identity evidence (GitHub / GitLab) — keyed by provider type
    identity_snaps = _build_identity_snapshots(db, acc.org_id, generated_at)
    snap_by_type.update(identity_snaps)

    # CloudTrail change events — used for CC8.1 change management evidence
    snap_by_type["cloudtrail_event"] = _build_cloudtrail_event_snapshots(
        db, account_id, since, end, limit=_CLOUDTRAIL_EVENT_LIMIT
    )

    # CI/CD pipeline evidence (GitHub Actions workflow runs + GitLab CI pipelines)
    cicd_snaps = _build_cicd_snapshots(db, acc.org_id, since)
    snap_by_type.update(cicd_snaps)

    providers = db.scalars(
        select(IdentityProvider).where(IdentityProvider.org_id == org_id)
    ).all()
    has_successful_scan = bool(
        db.scalars(
            select(ScanRun)
            .where(ScanRun.account_id == account_id, ScanRun.status == "ok")
            .limit(1)
        ).first()
    )
    evidence_sources = _evidence_sources(providers)

    control_results: list[dict[str, Any]] = []
    for ctrl in controls:
        status, hits = _control_status(pack_findings, check_map[ctrl.id])
        relevant_types = _entity_types_for_checks(check_map[ctrl.id])
        snaps = []
        for t in relevant_types:
            snaps.extend(snap_by_type.get(t, []))

        # When no snapshots exist (e.g. resource was never present — CloudTrail not enabled),
        # synthesize entries from finding evidence so auditors see account state rather than [].
        if not snaps and hits:
            snaps = [
                {
                    "entity_id": f.resource_arn,
                    "taken_at": generated_at.isoformat(),
                    "data": {**(f.evidence or {}), "_synthetic": True, "note": "Resource absent — no collected snapshot. Evidence derived from finding."},
                }
                for f, _st in hits[:50]
            ]

        exceptions = [_finding_dict(f, state=st) for f, st in hits if st == STATE_EXCEPTED]
        open_count = len([1 for f, st in hits if finding_open_for_control(f, st)])
        open_finding_dicts = [_finding_dict(f, state=st) for f, st in hits if st == STATE_OPEN]
        supporting_open = len([1 for f, st in hits if st == STATE_OPEN and not finding_open_for_control(f, st)])
        snapshots_total = len(snaps)
        mapped = check_map[ctrl.id]
        cov_tier = control_coverage_tier(mapped)
        scope, scope_label = _control_scope(mapped)
        cr_dict = {
                "control_id": ctrl.control_id,
                "title": ctrl.title,
                "description": ctrl.description,
                "guidance": ctrl.guidance or "",
                "scope": scope,
                "scope_label": scope_label,
                "coverage_tier": cov_tier,
                "extended_check_ids": extended_checks_in_list(mapped),
                "check_tiers": {cid: tier_for_check(cid) for cid in mapped},
                "check_evidence_classes": {cid: evidence_class_for_check(cid) for cid in mapped},
                "status": status,
                "evidence_status": _evidence_status(check_map[ctrl.id], snaps, has_successful_scan),
                "finding_count": open_count,
                "supporting_open_count": supporting_open,
                "exception_count": len(exceptions),
                "findings": open_finding_dicts,
                "exceptions": exceptions,
                "snapshots": snaps[:_SNAPSHOT_EMBED_LIMIT],
                "snapshots_total": snapshots_total,
                "snapshots_truncated": snapshots_total > _SNAPSHOT_EMBED_LIMIT,
                "status_note": _control_status_note(
                    status, open_count, exceptions, supporting_open=supporting_open
                ),
                "exception_narratives": _exception_narratives(exceptions),
                "review_reason": _review_reason(status, open_count, open_finding_dicts, check_map[ctrl.id]),
        }
        cr_dict["audit_block"] = build_control_audit_block(
            ctrl,
            cr_dict,
            check_map[ctrl.id],
            since=since,
            end=generated_at,
            evidence_sources=evidence_sources,
        )
        control_results.append(cr_dict)

    from app.services.control_coverage_store import sync_control_coverages, sync_evidence_requirements

    sync_evidence_requirements(db, org_id, framework)
    sync_control_coverages(db, org_id, account_id, framework, control_results)

    scan_runs = db.scalars(
        select(ScanRun)
        .where(
            ScanRun.account_id == account_id,
            ScanRun.started_at >= since,
            ScanRun.started_at <= end,
        )
        .order_by(ScanRun.started_at.desc())
    ).all()
    access_roster = _build_access_roster(db, account_id, end)
    from app.services.iam_history import build_iam_history

    iam_history = build_iam_history(db, account_id, end)
    mapped_check_ids = {cid for ids in check_map.values() for cid in ids}
    timeline_rows = _collect_timeline_rows(
        db, account_id, since, scan_runs, mapped_check_ids, control_results
    )

    report_id = _report_id(account_id, framework, generated_at)
    evidence_classes_map = all_evidence_classes()

    buf = io.BytesIO()
    artifacts: list[tuple[str, bytes]] = []
    vault_plan = None

    def _add(path: str, content: str | bytes) -> None:
        data = content.encode("utf-8") if isinstance(content, str) else content
        artifacts.append((path, data))

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        def _write(path: str, content: str | bytes) -> None:
            _add(path, content)
            zf.writestr(path, artifacts[-1][1])

        readme = _build_readme(acc, framework, period_days, generated_at, control_results, since)
        _write("README.txt", readme)

        index_csv = _build_index_csv(control_results)
        _write("INDEX.csv", index_csv)
        _write("control_status.csv", index_csv)

        timeline_csv = _build_timeline_csv(timeline_rows)
        _write("timeline.csv", timeline_csv)

        pack_prov = build_pack_provenance(generated_at=generated_at)
        manifest = _build_source_manifest(
            acc, framework, period_days, generated_at, since,
            providers, snapshots, snap_by_type, scan_runs, mapped_check_ids,
            coverage=coverage,
            report_id=report_id,
            evidence_classes=evidence_classes_map,
            pack_provenance=pack_prov,
        )
        _write("source_manifest.json", json.dumps(manifest, indent=2, default=str))
        _write("access_roster.json", json.dumps(access_roster, indent=2, default=str))
        _write("iam_history.json", json.dumps(iam_history, indent=2, default=str))
        _write("evidence_coverage.json", json.dumps(coverage, indent=2, default=str))
        _write(
            "check_evidence_classes.json",
            json.dumps(
                {
                    "labels": {
                        "benchmark": evidence_class_label("benchmark"),
                        "supporting": evidence_class_label("supporting"),
                        "hygiene": evidence_class_label("hygiene"),
                        "activity": evidence_class_label("activity"),
                    },
                    "checks": evidence_classes_map,
                },
                indent=2,
            ),
        )
        if framework == "cis_aws_l1":
            _write("cis_benchmark_coverage.json", json.dumps(cis_benchmark_coverage(), indent=2, default=str))

        for cr in control_results:
            folder = f"controls/{cr['control_id']}/"
            _write(folder + "summary.json", json.dumps({
                "control_id": cr["control_id"],
                "title": cr["title"],
                "framework": framework,
                "scope": cr.get("scope", "cloud_account"),
                "scope_label": cr.get("scope_label"),
                "status": cr["status"],
                "status_note": cr["status_note"],
                "finding_count": cr["finding_count"],
                "exception_count": cr["exception_count"],
                "exception_narratives": cr["exception_narratives"],
                "snapshots_total": cr.get("snapshots_total", 0),
                "snapshots_included": len(cr["snapshots"]),
                "snapshots_truncated": cr.get("snapshots_truncated", False),
                "description": cr["description"],
                "guidance": cr["guidance"],
                "coverage_tier": cr.get("coverage_tier", "core"),
                "extended_check_ids": cr.get("extended_check_ids", []),
                "check_tiers": cr.get("check_tiers", {}),
                "check_evidence_classes": cr.get("check_evidence_classes", {}),
                "generated_at": generated_at.isoformat(),
                "period_start": since.isoformat(),
                "period_end": generated_at.isoformat(),
                "audit_block": cr.get("audit_block"),
            }, indent=2))
            _write(folder + "findings.json", json.dumps(cr["findings"], indent=2, default=str))
            _write(folder + "exceptions.json", json.dumps(cr["exceptions"], indent=2, default=str))
            _write(folder + "snapshots.json", json.dumps(cr["snapshots"], indent=2, default=str))

        from app.services.external_evidence_export import write_external_evidence_to_pack

        external_summary = write_external_evidence_to_pack(
            db,
            org_id=org_id,
            framework=framework,
            write=_write,
        )
        _write("external_evidence_summary.json", json.dumps(external_summary, indent=2))
        from app.services.evidence_source_store import evidence_sources_for_export_db

        _write(
            "evidence_source_registry.json",
            json.dumps(evidence_sources_for_export_db(db, org_id), indent=2, default=str),
        )
        from app.services.category_evidence_coverage import build_category_evidence_coverage

        _write(
            "category_evidence_coverage.json",
            json.dumps(
                build_category_evidence_coverage(db, org_id=org_id, framework=framework, account_id=acc.id),
                indent=2,
                default=str,
            ),
        )
        _write(
            "sdlc_evidence.json",
            json.dumps(build_sdlc_evidence(db, org_id, since), indent=2, default=str),
        )
        _write(
            "access_review_summary.json",
            json.dumps(build_access_review_summary(db, org_id), indent=2, default=str),
        )
        from app.services.ai_pack_summary import build_ai_pack_summary

        _write(
            "ai_pack_summary.json",
            json.dumps(
                build_ai_pack_summary(
                    control_results,
                    framework=framework,
                    period_days=period_days,
                    account_label=acc.label or acc.account_id,
                ),
                indent=2,
                default=str,
            ),
        )
        _write(
            "scanner_integrations.json",
            json.dumps(_build_scanner_integrations(db, org_id), indent=2, default=str),
        )
        _write(
            "siem_integrations.json",
            json.dumps(_build_siem_integrations(db, org_id), indent=2, default=str),
        )

        from app.services.pack_signing import signing_enabled

        pdf_bytes = build_pdf(
            acc,
            framework,
            period_days,
            generated_at,
            control_results,
            since=since,
            evidence_sources=evidence_sources,
            report_id=report_id,
            benchmark_coverage=cis_benchmark_coverage() if framework == "cis_aws_l1" else None,
            coverage=coverage,
            vault_enabled=vault_enabled(),
            signature_enabled=signing_enabled(),
            pack_provenance=pack_prov,
        )
        _write("report.pdf", pdf_bytes)

        checksum_body = _build_checksum_manifest(artifacts, generated_at=generated_at, report_id=report_id)
        _write("checksum_manifest.json", checksum_body)

        from app.services.pack_signing import build_pack_signature

        sig_doc = build_pack_signature(checksum_body)
        if sig_doc:
            _write("pack_signature.json", json.dumps(sig_doc, indent=2))

        checksum_sha = None
        try:
            import hashlib as _hashlib

            checksum_sha = _hashlib.sha256(checksum_body.encode("utf-8")).hexdigest()
        except Exception:  # noqa: BLE001
            pass
        vault_plan = plan_vault_upload(
            org_id=acc.org_id,
            account_id=account_id,
            report_id=report_id,
            framework=framework,
            content_sha256=checksum_sha,
            generated_at=generated_at,
            customer_s3_uri=org_vault_override(org.settings if org else None),
            aws_account_id=acc.account_id,
        )

    zip_bytes = buf.getvalue()
    vault_upload_result: dict[str, Any] | None = None

    if vault_plan:
        vault_doc = vault_plan.to_manifest()
        vault_doc["vault_enabled"] = vault_enabled()
        auditor = plan_auditor_access(vault_plan) if vault_enabled() else None
        if auditor:
            vault_doc["auditor_access_plan"] = auditor.to_manifest()
        out = io.BytesIO(zip_bytes)
        with zipfile.ZipFile(out, "a", zipfile.ZIP_DEFLATED) as zf_append:
            zf_append.writestr("vault_upload_plan.json", json.dumps(vault_doc, indent=2, default=str))
        zip_bytes = out.getvalue()

        if vault_enabled():
            try:
                vault_upload_result = upload_pack_to_vault(vault_plan, zip_bytes)
            except Exception:  # noqa: BLE001
                log.exception("vault.upload_failed", report_id=report_id)
                vault_upload_result = {"status": "error", "s3_uri": vault_plan.s3_uri}
            out = io.BytesIO(zip_bytes)
            with zipfile.ZipFile(out, "a", zipfile.ZIP_DEFLATED) as zf_append:
                zf_append.writestr(
                    "vault_upload_result.json",
                    json.dumps(vault_upload_result, indent=2, default=str),
                )
            zip_bytes = out.getvalue()

    return EvidencePackResult(
        zip_bytes=zip_bytes,
        report_id=report_id,
        vault_upload=vault_upload_result,
    )


def _entity_types_for_checks(check_ids: list[str]) -> list[str]:
    types = set()
    for cid in check_ids:
        if cid.startswith("iam.root"):
            types.add("account_summary")
        elif cid.startswith("iam.user") or cid.startswith("iam.access_inventory"):
            types.add("iam_user")
            types.add("identity_center_user")
        elif cid.startswith("iam.account.") or cid == "iam.account.password_policy_weak":
            types.add("iam_password_policy")
        elif cid.startswith("iam.policy."):
            types.add("iam_role")
        elif cid.startswith("iam.access_key"):
            types.add("iam_access_key")
        elif cid.startswith("iam.role"):
            types.add("iam_role")
        elif cid.startswith("s3.account."):
            types.add("s3_account_public_access_block")
        elif cid.startswith("s3."):
            types.add("s3_bucket")
        elif cid.startswith("kms."):
            types.add("kms_key")
        elif cid.startswith("cloudtrail."):
            types.add("cloudtrail_trail")
        elif cid.startswith("guardduty."):
            types.add("guardduty_detector")
            types.add("guardduty_finding")
        elif cid.startswith("aws.access_analyzer"):
            types.add("access_analyzer")
        elif cid.startswith("aws.config"):
            types.add("config_recorder")
            types.add("config_rule_compliance")
        elif cid.startswith("aws.securityhub"):
            types.add("security_hub")
        elif cid.startswith("vpc."):
            types.add("vpc")
        elif cid.startswith("ec2.security_group"):
            types.add("security_group")
        elif cid.startswith("ec2.instance"):
            types.add("ec2_instance")
        elif cid.startswith("ec2.ebs"):
            types.add("ebs_volume")
            types.add("ebs_encryption_default")
            types.add("ebs_snapshot")
        elif cid.startswith("ec2.ami"):
            types.add("ec2_ami")
        elif cid.startswith("iam.role.external"):
            types.add("iam_role")
        elif cid.startswith("acm."):
            types.add("acm_certificate")
        elif cid.startswith("lambda."):
            types.add("lambda_function")
        elif cid.startswith("secretsmanager."):
            types.add("secrets_manager_secret")
        elif cid.startswith("ssm."):
            types.add("ssm_parameter")
        elif cid.startswith("elb."):
            types.add("elb_load_balancer")
        elif cid.startswith("dynamodb."):
            types.add("dynamodb_table")
        elif cid.startswith("ecr."):
            types.add("ecr_repository")
        elif cid.startswith("eks."):
            types.add("eks_cluster")
        elif cid.startswith("sns."):
            types.add("sns_topic")
        elif cid.startswith("sqs."):
            types.add("sqs_queue")
        elif cid.startswith("rds.snapshot."):
            types.add("rds_snapshot")
        elif cid.startswith("rds."):
            types.add("rds_instance")
        elif cid.startswith("github."):
            types.add("github_identity")
            types.add("cloudtrail_event")
            types.add("workflow_run")
        elif cid.startswith("gitlab."):
            types.add("gitlab_identity")
            types.add("cloudtrail_event")
            types.add("ci_pipeline")
    return list(types)


def _build_identity_snapshots(
    db: Session,
    org_id: uuid.UUID,
    generated_at: datetime,
) -> dict[str, list[dict[str, Any]]]:
    """Build evidence snapshots from identity tables for GitHub and GitLab providers."""
    result: dict[str, list[dict[str, Any]]] = {}
    providers = db.scalars(
        select(IdentityProvider).where(IdentityProvider.org_id == org_id)
    ).all()

    for provider in providers:
        ptype = provider.type  # "github" or "gitlab"
        snap_key = f"{ptype}_identity"
        snaps: list[dict[str, Any]] = []

        users = db.scalars(
            select(IdentityUser).where(IdentityUser.provider_id == provider.id)
        ).all()
        for u in users:
            snaps.append({
                "entity_id": u.external_id,
                "taken_at": u.snapshot_taken_at.isoformat(),
                "data": {
                    "type": "identity_user",
                    "provider": ptype,
                    "external_id": u.external_id,
                    "name": u.name,
                    "email": u.email,
                    "mfa_enabled": u.mfa_enabled,
                    "status": u.status,
                    "last_active_at": u.last_active_at.isoformat() if u.last_active_at else None,
                },
            })

        repos = db.scalars(
            select(Repo).where(Repo.provider_id == provider.id)
        ).all()
        for repo in repos:
            protection = db.scalars(
                select(RepoProtection).where(RepoProtection.repo_id == repo.id)
            ).first()
            prs = db.scalars(
                select(PullRequest)
                .where(PullRequest.repo_id == repo.id)
                .order_by(PullRequest.merged_at.desc())
                .limit(10)
            ).all()
            snaps.append({
                "entity_id": repo.name,
                "taken_at": repo.snapshot_taken_at.isoformat(),
                "data": {
                    "type": "repo",
                    "provider": ptype,
                    "name": repo.name,
                    "default_branch": repo.default_branch,
                    "has_codeowners": repo.has_codeowners,
                    "protected_envs": repo.protected_envs,
                    "branch_protection": {
                        "required_reviews": protection.required_reviews if protection else None,
                        "dismiss_stale": protection.dismiss_stale if protection else None,
                        "require_code_owners": protection.require_code_owners if protection else None,
                        "allow_force_push": protection.allow_force_push if protection else None,
                    } if protection else None,
                    "recent_prs": [
                        {
                            "number": pr.number,
                            "author": pr.author,
                            "merged_by": pr.merged_by,
                            "merged_at": pr.merged_at.isoformat() if pr.merged_at else None,
                            "approval_count": pr.approval_count,
                            "required_review_count": pr.required_review_count,
                            "self_merge": pr.self_merge,
                        }
                        for pr in prs
                    ],
                },
            })

        result[snap_key] = snaps
    return result


def _build_access_roster(db: Session, account_id: uuid.UUID, as_of: datetime) -> dict[str, Any]:
    """Point-in-time access roster from latest evidence snapshots on or before ``as_of``."""
    snaps = db.scalars(
        select(EvidenceSnapshot)
        .where(
            EvidenceSnapshot.account_id == account_id,
            EvidenceSnapshot.entity_type.in_(
                ["iam_user", "identity_center_user", "identity_center_permission_set"]
            ),
            EvidenceSnapshot.taken_at <= as_of,
        )
        .order_by(EvidenceSnapshot.taken_at.desc())
    ).all()

    latest: dict[tuple[str, str], EvidenceSnapshot] = {}
    for s in snaps:
        key = (s.entity_type, s.entity_id)
        if key not in latest:
            latest[key] = s

    iam_users: list[dict[str, Any]] = []
    ic_users: list[dict[str, Any]] = []
    ic_permission_sets: list[dict[str, Any]] = []
    ic_account_assignments: list[dict[str, Any]] = []
    for (entity_type, _entity_id), snap in latest.items():
        data = snap.payload_json or {}
        if entity_type == "iam_user":
            iam_users.append({
                "arn": data.get("arn") or snap.entity_id,
                "username": data.get("username"),
                "mfa_enabled": data.get("mfa_active"),
                "has_console_password": data.get("has_console_password"),
                "last_used_at": data.get("last_used_at"),
                "snapshot_at": snap.taken_at.isoformat(),
            })
        elif entity_type == "identity_center_user":
            ic_users.append({
                "user_id": data.get("user_id"),
                "user_name": data.get("user_name"),
                "display_name": data.get("display_name"),
                "email": data.get("email"),
                "active": data.get("active"),
                "snapshot_at": snap.taken_at.isoformat(),
            })
        else:
            permission_set = {
                "permission_set_arn": data.get("permission_set_arn") or snap.entity_id,
                "name": data.get("name"),
                "description": data.get("description"),
                "session_duration": data.get("session_duration"),
                "provisioned_account_ids": data.get("provisioned_account_ids") or [],
                "assignment_count": data.get("assignment_count", 0),
                "snapshot_at": snap.taken_at.isoformat(),
            }
            ic_permission_sets.append(permission_set)
            for assignment in data.get("account_assignments") or []:
                ic_account_assignments.append({
                    "permission_set_arn": permission_set["permission_set_arn"],
                    "permission_set_name": permission_set["name"],
                    "account_id": assignment.get("account_id"),
                    "principal_id": assignment.get("principal_id"),
                    "principal_type": assignment.get("principal_type"),
                    "principal": assignment.get("principal"),
                    "snapshot_at": snap.taken_at.isoformat(),
                })

    # Fall back to live tables when no snapshots exist (pre-migration accounts).
    if not iam_users and not ic_users:
        for u in db.scalars(select(IamUser).where(IamUser.account_id == account_id)).all():
            iam_users.append({
                "arn": u.arn,
                "username": u.name,
                "mfa_enabled": u.mfa_enabled,
                "has_console_password": u.has_console_password,
                "last_used_at": u.password_last_used.isoformat() if u.password_last_used else None,
                "snapshot_at": None,
            })
        for u in db.scalars(select(IdentityCenterUser).where(IdentityCenterUser.account_id == account_id)).all():
            ic_users.append({
                "user_id": u.user_id,
                "user_name": u.user_name,
                "display_name": u.display_name,
                "email": u.email,
                "active": u.active,
                "snapshot_at": None,
            })

    return {
        "as_of": as_of.isoformat(),
        "source": "evidence_snapshots" if snaps else "live_tables_fallback",
        "iam_users": iam_users,
        "identity_center_users": ic_users,
        "identity_center_permission_sets": ic_permission_sets,
        "identity_center_account_assignments": ic_account_assignments,
        "summary": {
            "iam_user_count": len(iam_users),
            "identity_center_user_count": len(ic_users),
            "identity_center_permission_set_count": len(ic_permission_sets),
            "identity_center_account_assignment_count": len(ic_account_assignments),
        },
    }


def _build_cloudtrail_event_snapshots(
    db: Session,
    account_id: uuid.UUID,
    since: datetime,
    end: datetime,
    *,
    limit: int = _CLOUDTRAIL_EVENT_LIMIT,
) -> list[dict[str, Any]]:
    """Return significant CloudTrail write events as evidence snapshots for CC8.1."""
    events = db.scalars(
        select(CloudTrailEvent)
        .where(
            CloudTrailEvent.account_id == account_id,
            CloudTrailEvent.event_time >= since,
            CloudTrailEvent.event_time <= end,
        )
        .order_by(CloudTrailEvent.event_time.desc())
        .limit(limit)
    ).all()
    return [
        {
            "entity_id": evt.event_id,
            "taken_at": evt.event_time.isoformat(),
            "data": {
                "type": "cloudtrail_event",
                "event_name": evt.event_name,
                "event_source": evt.event_source,
                "event_time": evt.event_time.isoformat(),
                "actor": evt.actor,
                "source_ip": evt.source_ip,
                "resources": evt.resources or [],
            },
        }
        for evt in events
    ]


def _build_cicd_snapshots(
    db: Session,
    org_id: uuid.UUID,
    since: datetime,
) -> dict[str, list[dict[str, Any]]]:
    """Return workflow_run and ci_pipeline evidence snapshots keyed by type."""
    workflow_snaps: list[dict[str, Any]] = []
    pipeline_snaps: list[dict[str, Any]] = []

    providers = db.scalars(
        select(IdentityProvider).where(IdentityProvider.org_id == org_id)
    ).all()

    for provider in providers:
        repos = db.scalars(select(Repo).where(Repo.provider_id == provider.id)).all()
        repo_ids = [r.id for r in repos]
        repo_name_by_id = {r.id: r.name for r in repos}
        if not repo_ids:
            continue

        if provider.type == "github":
            runs = db.scalars(
                select(WorkflowRun)
                .where(
                    WorkflowRun.repo_id.in_(repo_ids),
                    WorkflowRun.run_started_at >= since,
                )
                .order_by(WorkflowRun.run_started_at.desc())
                .limit(200)
            ).all()
            for r in runs:
                workflow_snaps.append({
                    "entity_id": str(r.run_id),
                    "taken_at": r.snapshot_taken_at.isoformat(),
                    "data": {
                        "type": "workflow_run",
                        "repo": repo_name_by_id.get(r.repo_id, str(r.repo_id)),
                        "name": r.name,
                        "workflow_path": r.workflow_path,
                        "event": r.event,
                        "status": r.status,
                        "conclusion": r.conclusion,
                        "branch": r.branch,
                        "actor": r.actor,
                        "environment": r.environment,
                        "run_started_at": r.run_started_at.isoformat() if r.run_started_at else None,
                        "run_completed_at": r.run_completed_at.isoformat() if r.run_completed_at else None,
                    },
                })

        elif provider.type == "gitlab":
            pipelines = db.scalars(
                select(CiPipeline)
                .where(
                    CiPipeline.repo_id.in_(repo_ids),
                    CiPipeline.created_at >= since,
                )
                .order_by(CiPipeline.created_at.desc())
                .limit(200)
            ).all()
            for p in pipelines:
                pipeline_snaps.append({
                    "entity_id": str(p.pipeline_id),
                    "taken_at": p.snapshot_taken_at.isoformat(),
                    "data": {
                        "type": "ci_pipeline",
                        "repo": repo_name_by_id.get(p.repo_id, str(p.repo_id)),
                        "ref": p.ref,
                        "status": p.status,
                        "source": p.source,
                        "actor": p.actor,
                        "created_at": p.created_at.isoformat() if p.created_at else None,
                        "finished_at": p.finished_at.isoformat() if p.finished_at else None,
                        "duration_seconds": p.duration,
                    },
                })

    return {"workflow_run": workflow_snaps, "ci_pipeline": pipeline_snaps}


def _build_scanner_integrations(db: Session, org_id: uuid.UUID) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for vendor, provider_type in SCANNER_TYPES.items():
        provider = db.scalar(
            select(IdentityProvider).where(
                IdentityProvider.org_id == org_id,
                IdentityProvider.type == provider_type,
            )
        )
        if not provider:
            continue
        cfg = provider_config(provider)
        rows.append(
            {
                "vendor": vendor,
                "status": provider.status,
                "last_synced_at": provider.last_synced_at.isoformat() if provider.last_synced_at else None,
                **public_config(vendor, cfg),
            }
        )
    return {"integrations": rows}


def _build_siem_integrations(db: Session, org_id: uuid.UUID) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for vendor, provider_type in SIEM_TYPES.items():
        provider = db.scalar(
            select(IdentityProvider).where(
                IdentityProvider.org_id == org_id,
                IdentityProvider.type == provider_type,
            )
        )
        if not provider:
            continue
        cfg = provider_config(provider)
        rows.append(
            {
                "vendor": vendor,
                "status": provider.status,
                "last_synced_at": provider.last_synced_at.isoformat() if provider.last_synced_at else None,
                **siem_public_config(vendor, cfg),
            }
        )
    return {"integrations": rows}


def _finding_scope(f: Finding) -> str:
    """Where the finding is scoped, so an auditor doesn't read a repo finding as
    belonging to the AWS account this pack was generated for."""
    if f.check_id.startswith("github."):
        return "source_control:github"
    if f.check_id.startswith("gitlab."):
        return "source_control:gitlab"
    return "cloud_account"


def _control_scope(check_ids: list[str]) -> tuple[str, str | None]:
    """(scope, human_label) for a control based on its mapped checks.

    Source-control controls (Secure SDLC) are org/workspace-level — evidence
    comes from GitHub/GitLab, not the AWS account this pack is scoped to. Label
    them so an auditor never reads a repo finding as an account finding.
    """
    if not check_ids:
        return "cloud_account", None
    sc = [c for c in check_ids if c.startswith(("github.", "gitlab."))]
    if not sc:
        return "cloud_account", None
    providers = sorted({"GitHub" if c.startswith("github.") else "GitLab" for c in sc})
    src = " / ".join(providers)
    if len(sc) == len(check_ids):
        return "workspace_source_control", f"Workspace-level · Source: {src} · not scoped to this cloud account"
    return "mixed_source_control", f"Includes workspace-level source-control evidence ({src})"


def _finding_dict(f: Finding, *, state: str | None = None) -> dict[str, Any]:
    effective = state if state is not None else f.status
    d: dict[str, Any] = {
        "id": str(f.id),
        "check_id": f.check_id,
        "resource_arn": f.resource_arn,
        "title": f.title,
        "severity": f.severity,
        "risk_score": f.risk_score,
        "status": effective,
        "scope": _finding_scope(f),
        "first_seen": f.first_seen.isoformat(),
        "last_seen": f.last_seen.isoformat(),
        "evidence": f.evidence,
    }
    if effective == "excepted":
        d["exception"] = {
            "reason": f.exception_reason,
            "approved_by": f.exception_approved_by,
            "expires_at": f.exception_expires_at.isoformat() if f.exception_expires_at else None,
        }
    return d


def _report_id(account_id: uuid.UUID, framework: str, generated_at: datetime) -> str:
    raw = f"{account_id}:{framework}:{generated_at.isoformat()}".encode()
    return hashlib.sha256(raw).hexdigest()[:12].upper()


def _evidence_sources(providers: list[IdentityProvider]) -> list[str]:
    sources = ["AWS IAM", "AWS CloudTrail", "AWS Config"]
    for p in providers:
        if p.status == "connected":
            if p.type == "github":
                sources.append("GitHub")
            elif p.type == "gitlab":
                sources.append("GitLab")
    return sources


def _evidence_status(check_ids: list[str], snaps: list[dict[str, Any]], has_scan: bool) -> str:
    if not check_ids:
        return "missing"
    if not snaps:
        return "partial" if has_scan else "missing"
    if all((s.get("data") or {}).get("_synthetic") for s in snaps):
        return "partial"
    return "complete"


def _review_reason(
    status: str,
    open_count: int,
    findings: list[dict[str, Any]],
    check_ids: list[str],
) -> str:
    if status == "pass":
        return "No open findings mapped to this control."
    if status == "no_data":
        if not check_ids:
            return "No automated checks mapped — manual attestation required."
        return "No scan evidence collected yet for mapped checks."
    if open_count == 1 and findings:
        return findings[0].get("title", "One open finding requires remediation or documented exception.")
    return f"{open_count} open finding(s) mapped to this control require remediation or documented exception."


def _control_status_note(
    status: str,
    open_count: int,
    exceptions: list[dict[str, Any]],
    *,
    supporting_open: int = 0,
) -> str:
    if status == "pass" and exceptions:
        return f"PASS with {len(exceptions)} approved exception(s) — no open benchmark findings"
    if status == "pass" and supporting_open:
        return (
            f"PASS — {supporting_open} supporting finding(s) present; "
            "does not fail benchmark control status"
        )
    if status == "pass":
        return "PASS — no open benchmark findings mapped to this control"
    if status == "at_risk":
        return (
            f"AT RISK — {supporting_open or open_count} open supporting finding(s) on a control "
            "with no benchmark-class checks; monitored signals need attention"
        )
    if status == "no_data":
        return "NO DATA — no automated checks mapped or no scan data in period"
    if exceptions:
        return (
            f"FAIL — {open_count} open finding(s), {len(exceptions)} approved exception(s). "
            "See exception_narratives for risk-accepted items."
        )
    return f"FAIL — {open_count} open finding(s)"


def _exception_narratives(exceptions: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for ex in exceptions:
        exc = ex.get("exception") or {}
        approver = exc.get("approved_by") or "unknown approver"
        expires = exc.get("expires_at")
        reason = exc.get("reason") or "No reason recorded"
        expiry = f" until {expires[:10]}" if expires else ""
        lines.append(
            f"Finding '{ex.get('title', ex.get('check_id'))}' — exception approved by {approver}{expiry}. "
            f"Reason: {reason}"
        )
    return lines


def _collect_timeline_rows(
    db: Session,
    account_id: uuid.UUID,
    since: datetime,
    scan_runs: list[ScanRun],
    mapped_check_ids: set[str],
    control_results: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []

    for run in scan_runs:
        ts = run.finished_at or run.started_at
        rows.append({
            "timestamp": ts.isoformat(),
            "event_type": "scan_completed" if run.status == "ok" else f"scan_{run.status}",
            "control_id": "",
            "check_id": "",
            "resource_arn": "",
            "detail": (
                f"Scan {run.status}; opened={run.findings_opened} resolved={run.findings_resolved}"
            ),
        })

    from app.services.source_control_scan import with_source_control_for_audit

    findings = db.scalars(
        select(Finding).where(
            with_source_control_for_audit(Finding.account_id == account_id),
            Finding.check_id.in_(mapped_check_ids) if mapped_check_ids else True,
        )
    ).all()
    finding_ids = [f.id for f in findings]
    events: list[FindingEvent] = []
    if finding_ids:
        events = db.scalars(
            select(FindingEvent)
            .where(
                FindingEvent.finding_id.in_(finding_ids),
                FindingEvent.ts >= since,
            )
            .order_by(FindingEvent.ts.asc())
        ).all()
    finding_by_id = {f.id: f for f in findings}

    for evt in events:
        f = finding_by_id.get(evt.finding_id)
        if not f:
            continue
        rows.append({
            "timestamp": evt.ts.isoformat(),
            "event_type": f"finding_{evt.action}",
            "control_id": "",
            "check_id": f.check_id,
            "resource_arn": f.resource_arn,
            "detail": evt.note or f.title,
        })

    for f in findings:
        if f.first_seen >= since:
            rows.append({
                "timestamp": f.first_seen.isoformat(),
                "event_type": "finding_first_seen",
                "control_id": "",
                "check_id": f.check_id,
                "resource_arn": f.resource_arn,
                "detail": f.title,
            })
        if f.resolved_at and f.resolved_at >= since:
            rows.append({
                "timestamp": f.resolved_at.isoformat(),
                "event_type": "finding_resolved",
                "control_id": "",
                "check_id": f.check_id,
                "resource_arn": f.resource_arn,
                "detail": f.title,
            })
        if f.status == "excepted" and f.exception_approved_by:
            rows.append({
                "timestamp": f.last_seen.isoformat(),
                "event_type": "exception_active",
                "control_id": "",
                "check_id": f.check_id,
                "resource_arn": f.resource_arn,
                "detail": (
                    f"Exception approved by {f.exception_approved_by}"
                    + (f" until {f.exception_expires_at.date()}" if f.exception_expires_at else "")
                    + f": {f.exception_reason or ''}"
                ),
            })

    for cr in control_results:
        if cr["status"] == "fail" and cr["finding_count"]:
            rows.append({
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "event_type": "control_failing",
                "control_id": cr["control_id"],
                "check_id": "",
                "resource_arn": "",
                "detail": cr["status_note"],
            })

    rows.sort(key=lambda r: r["timestamp"])
    return rows


def _build_timeline_csv(rows: list[dict[str, Any]]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["timestamp", "event_type", "control_id", "check_id", "resource_arn", "detail"])
    for r in rows:
        writer.writerow([
            r["timestamp"],
            r["event_type"],
            r["control_id"],
            r["check_id"],
            r["resource_arn"],
            r["detail"],
        ])
    return buf.getvalue()


def _build_checksum_manifest(
    artifacts: list[tuple[str, bytes]],
    *,
    generated_at: datetime,
    report_id: str,
) -> str:
    """SHA-256 per ZIP member (excluding this manifest file)."""
    checksums = {
        path: hashlib.sha256(data).hexdigest()
        for path, data in artifacts
        if path != "checksum_manifest.json"
    }
    body = {
        "algorithm": "sha256",
        "generated_at": generated_at.isoformat(),
        "report_id": report_id,
        "note": "checksum_manifest.json is not self-hashed; verify other files then validate JSON structure.",
        "artifacts": checksums,
    }
    return json.dumps(body, indent=2)


def _build_source_manifest(
    acc: AwsAccount,
    framework: str,
    period_days: int,
    generated_at: datetime,
    since: datetime,
    providers: list[IdentityProvider],
    snapshots: list[EvidenceSnapshot],
    snap_by_type: dict[str, list[dict[str, Any]]],
    scan_runs: list[ScanRun],
    mapped_check_ids: set[str],
    *,
    coverage: dict[str, Any] | None = None,
    report_id: str | None = None,
    evidence_classes: dict[str, str] | None = None,
    pack_provenance: dict[str, Any] | None = None,
) -> dict[str, Any]:
    integrations: list[dict[str, Any]] = [{
        "type": "aws",
        "account_label": acc.label,
        "account_id": acc.account_id,
        "status": acc.status,
        "last_scan_at": acc.last_scan_at.isoformat() if acc.last_scan_at else None,
    }]
    for p in providers:
        integrations.append({
            "type": p.type,
            "status": p.status,
            "last_synced_at": p.last_synced_at.isoformat() if p.last_synced_at else None,
        })

    snapshot_counts = {k: len(v) for k, v in snap_by_type.items()}
    successful_scans = [r for r in scan_runs if r.status == "ok"]

    from app.data.control_narratives import scope_limitations_for

    return {
        "pack_version": (pack_provenance or {}).get("pack_version", "2.3"),
        "generated_at": generated_at.isoformat(),
        "report_id": report_id,
        "framework": framework,
        "scope_limitations": scope_limitations_for(framework),
        "pack_provenance": pack_provenance,
        "evidence_class_labels": {
            "benchmark": evidence_class_label("benchmark"),
            "supporting": evidence_class_label("supporting"),
            "hygiene": evidence_class_label("hygiene"),
            "activity": evidence_class_label("activity"),
        },
        "check_evidence_classes": evidence_classes or {},
        "audit_period": {
            "days": period_days,
            "start": since.isoformat(),
            "end": generated_at.isoformat(),
        },
        "account": {
            "label": acc.label,
            "aws_account_id": acc.account_id,
        },
        "integrations": integrations,
        "collection_summary": {
            "scan_runs_in_period": len(scan_runs),
            "successful_scans": len(successful_scans),
            "evidence_snapshots_in_period": len(snapshots),
            "snapshot_types": snapshot_counts,
            "mapped_check_count": len(mapped_check_ids),
            "evidence_coverage": coverage or {},
        },
        "artifacts": {
            "README.txt": "Start here — pack overview and auditor instructions",
            "report.pdf": "Executive summary for auditors (pass/fail overview)",
            "INDEX.csv": "Control status table (same as control_status.csv)",
            "control_status.csv": "Per-control pass/fail with open finding and exception counts",
            "timeline.csv": "Chronological scan, finding, and exception events in audit period",
            "source_manifest.json": "This file — collection metadata and integration sources",
            "controls/": "Per-control folders with summary.json, findings.json, exceptions.json, snapshots.json",
            "access_roster.json": "IAM + Identity Center user roster as of pack end date",
            "iam_history.json": "Point-in-time IAM entities from evidence snapshots as of period end",
            "evidence_coverage.json": "Days of scan data vs requested audit period",
            "check_evidence_classes.json": "Per-check classification: benchmark | supporting | hygiene | activity",
            "checksum_manifest.json": "SHA-256 checksums for pack integrity verification",
            "pack_signature.json": "Ed25519 signature over checksum_manifest.json (when signing key configured)",
            "vault_upload_plan.json": "Planned immutable S3 destination (when EVIDENCE_VAULT_ENABLED)",
            "iam_history.json": "Snapshot-based IAM entities as of period end",
            "cis_benchmark_coverage.json": "CIS mapped-control matrix (CIS packs only)",
        },
        "auditor_note": (
            "Raw evidence is in controls/*/snapshots.json. Cross-reference timeline.csv "
            "for when findings opened or resolved during the audit period."
        ),
    }


def _build_readme(
    acc: AwsAccount,
    framework: str,
    period_days: int,
    generated_at: datetime,
    results: list[dict[str, Any]],
    since: datetime,
) -> str:
    passed = sum(1 for r in results if r["status"] == "pass")
    failed = sum(1 for r in results if r["status"] == "fail")
    no_data = sum(1 for r in results if r["status"] == "no_data")
    excepted_controls = sum(1 for r in results if r.get("exception_count", 0) > 0)
    lines = [
        "VERITRAIL - COMPLIANCE EVIDENCE PACK (v2)",
        "=" * 50,
        f"Account:     {acc.label} ({acc.account_id or 'unknown'})",
        f"Framework:   {framework.upper().replace('_', ' ')}",
        f"Period:      {since.date()} to {generated_at.date()} ({period_days} days)",
        f"Generated:   {generated_at.strftime('%Y-%m-%d %H:%M UTC')} (as-of end of period)",
        "",
        "START HERE",
        "-" * 30,
        "1. Read report.pdf for the auditor-facing summary.",
        "2. Open INDEX.csv (or control_status.csv) for pass/fail per control.",
        "3. Drill into controls/[ID]/ for raw JSON evidence per control.",
        "4. Use timeline.csv to show when findings opened, resolved, or were excepted.",
        "5. source_manifest.json lists integrations and snapshot counts collected.",
        "6. access_roster.json — IAM + Identity Center users as of period end.",
        "7. iam_history.json — snapshot-based IAM roster as of period end (Type II sampling).",
        "8. evidence_coverage.json — days of collected data vs requested period.",
        "",
        "SUMMARY",
        "-" * 30,
        f"PASS:     {passed}",
        f"FAIL:     {failed}",
        f"NO DATA:  {no_data}",
        f"TOTAL:    {len(results)}",
        f"Controls with approved exceptions: {excepted_controls}",
        "",
        "CONTENTS",
        "-" * 30,
        "README.txt           - this file",
        "report.pdf           - formatted summary report (auditor overview)",
        "INDEX.csv            - control ID, status, open findings, exceptions",
        "control_status.csv   - same as INDEX.csv (alias for auditor workflows)",
        "timeline.csv         - scan + finding + exception events in audit period",
        "source_manifest.json - integrations, scan counts, snapshot inventory",
        "controls/[ID]/       - per-control evidence folder",
        "  summary.json       - status, status_note, exception_narratives",
        "  findings.json      - open findings mapped to this control",
        "  exceptions.json    - approved exceptions with approver + expiry",
        "  snapshots.json     - raw evidence (see snapshots_total in summary.json if truncated)",
        "external-evidence/ - customer-uploaded proof from external systems",
        "  manifest.json      - metadata, review status, checksums, control mapping",
        "  [group]/           - accepted/submitted files organized by compliance group",
        "external_evidence_summary.json - counts of uploaded external artifacts",
        "evidence_source_registry.json - workspace-declared external systems by compliance category",
        "category_evidence_coverage.json - automated vs external evidence coverage by category",
        "",
        "EXCEPTIONS",
        "-" * 30,
        "Approved exceptions appear in exceptions.json and summary.json.",
        "Excepted findings do not cause a control to FAIL — see status_note.",
        "",
        "coverage_tier in INDEX.csv:",
        "  core     — mapped checks align to common benchmark evidence",
        "  extended — supports the control objective; not a prescriptive framework checklist item",
        "  mixed    — both core and extended checks contribute to status",
        "",
        "check_evidence_classes.json:",
        "  benchmark  — required mapped control evidence",
        "  supporting — corroborating evidence (extended tier checks)",
        "  hygiene    — optional cleanup checks (off by default)",
        "",
        "checksum_manifest.json lists SHA-256 hashes for every file except itself.",
        "pack_signature.json (when present) proves manifest integrity — verify with GET /v1/meta/evidence-pack-signing-key.",
        "",
        "NOTE: Evidence in snapshots.json is raw API data collected by",
        "Veritrail during scans. Each entry includes a taken_at timestamp.",
        "Auditors may request specific date-range exports to confirm a",
        "control was in effect on a sampled date.",
    ]
    from app.data.control_narratives import scope_limitations_for

    scope_lines = scope_limitations_for(framework)
    if scope_lines:
        lines.extend(["", "ASSUMPTIONS & SCOPE BOUNDARIES", "-" * 30])
        for item in scope_lines:
            lines.append(f"  • {item}")
        lines.append("")
        lines.append(
            "See also source_manifest.json (scope_limitations) and report.pdf for the same boundaries."
        )
    return "\n".join(lines)


def _build_index_csv(results: list[dict[str, Any]]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "control_id",
        "title",
        "status",
        "coverage_tier",
        "open_findings",
        "exceptions",
        "status_note",
    ])
    for r in results:
        writer.writerow([
            r["control_id"],
            r["title"],
            r["status"],
            r.get("coverage_tier", "core"),
            r["finding_count"],
            r.get("exception_count", 0),
            r.get("status_note", ""),
        ])
    return buf.getvalue()
