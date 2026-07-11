"""Org-wide audit readiness narratives — shared builder with the evidence PDF."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    AwsAccount,
    AzureSubscription,
    EvidenceSnapshot,
    Finding,
    FindingEvent,
    GcpProject,
    ScanRun,
)
from app.models.control import CheckControl, Control
from app.models.github import IdentityProvider
from app.models.org import Org
from app.services.check_settings import hidden_check_ids
from app.services.compliance_timeline import build_control_history
from app.services.evidence_pack import _control_status, _finding_dict
from app.services.finding_history import STATE_EXCEPTED, STATE_OPEN, findings_for_pack_at
from app.services.org_control_mappings import load_org_mapping_index
from app.services.pdf_narrative import (
    CHECK_VERIFIED_PHRASES,
    DOMAIN_DEFS,
    build_domain_sections,
    domain_for_check,
    domain_section_as_dict,
)
from app.services.seed_controls import effective_checks_for_control_row
from app.services.source_control_scan import with_source_control_for_audit

_VULN_CHECKS = frozenset(
    {
        "aws.inspector.active_critical_finding",
        "aws.vulnerability_monitoring.not_detected",
        "ecr.repository.image_scan_disabled",
        "ecr.registry.enhanced_scanning_disabled",
    }
)
_SDLC_CHECKS = frozenset(
    {
        "github.repo.no_branch_protection",
        "gitlab.repo.no_branch_protection",
        "github.repo.dependabot_disabled",
        "github.repo.secret_scanning_disabled",
        "github.repo.code_scanning_disabled",
    }
)

_PROVIDER_PREFIXES: dict[str, tuple[str, ...]] = {
    "azure": ("azure.",),
    "gcp": ("gcp.",),
    "entra_id": ("entra.", "azure.entra."),
    "google_workspace": ("google_workspace.",),
    "github": ("github.",),
    "gitlab": ("gitlab.",),
    "scanner_wiz": ("scanner.wiz.",),
    "scanner_tenable": ("scanner.tenable.",),
    "scanner_qualys": ("scanner.qualys.",),
    "scanner_snyk": ("scanner.snyk.",),
    "scanner_orca": ("scanner.orca.",),
    "scanner_aikido": ("scanner.aikido.",),
}

_AUDIT_CAPABILITIES: tuple[dict[str, Any], ...] = (
    {
        "key": "database_recovery",
        "domain": "backup_dr",
        "label": "Database recovery",
        "checks": (
            "rds.instance.no_automated_backup",
            "rds.instance.no_deletion_protection",
            "rds.instance.no_multi_az",
            "dynamodb.table.no_pitr",
        ),
    },
    {
        "key": "backup_coverage",
        "domain": "backup_dr",
        "label": "AWS Backup coverage",
        "checks": ("backup.plan.missing",),
    },
    {
        "key": "vulnerability_scanning",
        "domain": "vulnerability_management",
        "label": "Vulnerability scanning",
        "checks": (
            "aws.vulnerability_monitoring.not_detected",
            "aws.inspector.active_critical_finding",
        ),
        "prefixes": ("scanner.",),
    },
    {
        "key": "container_scanning",
        "domain": "vulnerability_management",
        "label": "Container image scanning",
        "checks": (
            "ecr.registry.enhanced_scanning_disabled",
            "ecr.repository.image_scan_disabled",
        ),
    },
    {
        "key": "threat_detection",
        "domain": "incident_response",
        "label": "Threat detection",
        "checks": (
            "guardduty.detector.not_enabled",
            "aws.securityhub.not_enabled",
            "cloudtrail.event.guardduty_disabled",
            "guardduty.open_findings",
        ),
    },
    {
        "key": "audit_logging",
        "domain": "logging_monitoring",
        "label": "Audit logging",
        "checks": tuple(),
        "prefixes": ("cloudtrail.",),
    },
    {
        "key": "configuration_monitoring",
        "domain": "logging_monitoring",
        "label": "Configuration monitoring",
        "checks": ("aws.config.not_enabled", "aws.config.rules_non_compliant"),
    },
    {
        "key": "network_visibility",
        "domain": "logging_monitoring",
        "label": "Network visibility",
        "checks": ("vpc.flow_logs.not_enabled",),
    },
)

_SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}

_CHECK_RESOURCE_TYPES: tuple[tuple[str, frozenset[str], str], ...] = (
    ("rds.", frozenset({"rds_instance", "rds_snapshot"}), "RDS resources"),
    ("dynamodb.", frozenset({"dynamodb_table"}), "DynamoDB tables"),
    ("ecr.", frozenset({"ecr_repository"}), "ECR repositories"),
    (
        "ecs.",
        frozenset({"ecs_cluster", "ecs_service", "ecs_task_definition"}),
        "ECS resources",
    ),
    ("eks.", frozenset({"eks_cluster"}), "EKS clusters"),
    ("elb.", frozenset({"elb_load_balancer"}), "load balancers"),
    ("lambda.", frozenset({"lambda_function"}), "Lambda functions"),
    ("s3.bucket.", frozenset({"s3_bucket"}), "S3 buckets"),
    ("ec2.ebs.", frozenset({"ebs_volume", "ebs_snapshot"}), "EBS resources"),
    (
        "backup.plan.missing",
        frozenset({"rds_instance", "dynamodb_table", "ec2_instance", "ebs_volume"}),
        "backup-eligible resources",
    ),
)


def _fmt_date(dt: datetime) -> str:
    return dt.strftime("%Y-%b-%d")


def _resource_label(arn: str) -> str:
    if not arn or arn == "-":
        return ""
    if "/" in arn:
        return arn.rsplit("/", 1)[-1]
    if ":" in arn:
        return arn.rsplit(":", 1)[-1]
    return arn


def _org_scope_label(db: Session, org_id: uuid.UUID, primary: AwsAccount | None) -> tuple[str, str]:
    """Return (account_label, account_id) for build_domain_sections."""
    connected = db.scalars(
        select(AwsAccount)
        .where(AwsAccount.org_id == org_id, AwsAccount.status == "connected")
        .order_by(AwsAccount.label.asc())
    ).all()
    org = db.get(Org, org_id)
    org_name = (org.name if org else None) or "organization"
    if not connected:
        return org_name, "workspace"
    if len(connected) == 1:
        acc = connected[0]
        return acc.label or acc.account_id, acc.account_id
    labels = [f"{a.label or a.account_id} ({a.account_id})" for a in connected[:4]]
    extra = len(connected) - len(labels)
    joined = ", ".join(labels)
    if extra > 0:
        joined += f", and {extra} more"
    return f"{org_name} — {joined}", primary.account_id if primary else connected[0].account_id


def build_org_control_results(
    db: Session,
    org_id: uuid.UUID,
    framework: str,
    *,
    as_of: datetime | None = None,
) -> tuple[list[dict[str, Any]], AwsAccount | None, datetime]:
    """Assemble per-control results for narrative building (org readiness home scoping)."""
    generated_at = as_of or datetime.now(timezone.utc)
    if generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=timezone.utc)

    primary = db.scalars(
        select(AwsAccount)
        .where(AwsAccount.org_id == org_id, AwsAccount.status == "connected")
        .order_by(AwsAccount.label.asc())
    ).first()

    org = db.get(Org, org_id)
    hidden = hidden_check_ids(org.settings if org else {})
    mapping_index = load_org_mapping_index(db, org_id)
    active_provider_prefixes = _active_provider_prefixes(db, org_id)

    pack_findings: list[tuple[Any, str]] = []
    if primary:
        pack_findings = findings_for_pack_at(
            db, primary.id, generated_at, hidden_check_ids=set(hidden)
        )

    controls = db.scalars(
        select(Control).where(Control.framework == framework).order_by(Control.control_id)
    ).all()

    control_results: list[dict[str, Any]] = []
    for ctrl in controls:
        links = db.scalars(
            select(CheckControl.check_id).where(CheckControl.control_id == ctrl.id)
        ).all()
        check_ids = [
            cid
            for cid in effective_checks_for_control_row(
                db, org_id, ctrl, list(links), mapping_index=mapping_index
            )
            if (
                cid not in hidden
                and _check_matches_connected_scope(cid, active_provider_prefixes)
            )
        ]
        if not check_ids:
            continue
        status, hits = _control_status(pack_findings, check_ids)
        exceptions = [_finding_dict(f, state=st) for f, st in hits if st == STATE_EXCEPTED]
        open_finding_dicts = [_finding_dict(f, state=st) for f, st in hits if st == STATE_OPEN]
        control_results.append(
            {
                "control_id": ctrl.control_id,
                "title": ctrl.title,
                "status": status,
                "findings": open_finding_dicts,
                "exceptions": exceptions,
                "check_evidence_classes": {cid: "benchmark" for cid in check_ids},
            }
        )
    return control_results, primary, generated_at


def _latest_scanned_entity_types(db: Session, account_id: uuid.UUID) -> set[str] | None:
    """Entity types from the latest successful scan; None means applicability is unknown."""
    scan_id = db.scalars(
        select(ScanRun.id)
        .where(ScanRun.account_id == account_id, ScanRun.status == "ok")
        .order_by(ScanRun.finished_at.desc().nullslast(), ScanRun.started_at.desc())
        .limit(1)
    ).first()
    if not scan_id:
        return None
    return set(
        db.scalars(
            select(EvidenceSnapshot.entity_type).where(EvidenceSnapshot.scan_run_id == scan_id).distinct()
        ).all()
    )


def _latest_org_scanned_entity_types(db: Session, org_id: uuid.UUID) -> set[str] | None:
    """Union latest inventories only when every connected AWS account has a good scan."""
    account_ids = db.scalars(
        select(AwsAccount.id).where(
            AwsAccount.org_id == org_id, AwsAccount.status == "connected"
        )
    ).all()
    if not account_ids:
        return None
    entity_types: set[str] = set()
    for account_id in account_ids:
        latest = _latest_scanned_entity_types(db, account_id)
        if latest is None:
            return None
        entity_types.update(latest)
    return entity_types


def _resource_requirement(check_id: str) -> tuple[frozenset[str], str] | None:
    for prefix, required_types, label in _CHECK_RESOURCE_TYPES:
        if check_id == prefix or check_id.startswith(prefix):
            return required_types, label
    return None


def _check_has_applicable_resources(
    check_id: str,
    scanned_entity_types: set[str] | None,
    observed_check_ids: set[str],
) -> bool:
    if check_id in observed_check_ids or scanned_entity_types is None:
        return True
    requirement = _resource_requirement(check_id)
    return requirement is None or bool(scanned_entity_types & requirement[0])


def _applicability_reason(
    check_ids: list[str],
    scanned_entity_types: set[str] | None,
    observed_check_ids: set[str],
) -> str | None:
    if scanned_entity_types is None or any(cid in observed_check_ids for cid in check_ids):
        return None
    requirements = [_resource_requirement(cid) for cid in check_ids]
    if not requirements or any(requirement is None for requirement in requirements):
        return None
    required_types = set().union(*(requirement[0] for requirement in requirements if requirement))
    if scanned_entity_types & required_types:
        return None
    labels = list(dict.fromkeys(requirement[1] for requirement in requirements if requirement))
    if len(labels) == 1:
        resource_label = labels[0]
    elif len(labels) == 2:
        resource_label = f"{labels[0]} or {labels[1]}"
    else:
        resource_label = ", ".join(labels[:-1]) + f", or {labels[-1]}"
    return f"No {resource_label} in scope"


def _without_inapplicable_checks(
    control_results: list[dict[str, Any]],
    scanned_entity_types: set[str] | None,
) -> list[dict[str, Any]]:
    """Remove safely-derived N/A checks from domain readiness calculations."""
    observed_check_ids = {
        str(finding.get("check_id") or "")
        for control in control_results
        for finding in (control.get("findings") or []) + (control.get("exceptions") or [])
    }
    filtered: list[dict[str, Any]] = []
    for control in control_results:
        evidence_classes = control.get("check_evidence_classes") or {}
        applicable = {
            check_id: evidence_class
            for check_id, evidence_class in evidence_classes.items()
            if _check_has_applicable_resources(
                check_id, scanned_entity_types, observed_check_ids
            )
        }
        if not applicable:
            continue
        filtered.append({**control, "check_evidence_classes": applicable})
    return filtered


def _active_provider_prefixes(db: Session, org_id: uuid.UUID) -> set[str]:
    """Prefixes for non-AWS providers that are genuinely connected in this workspace."""
    prefixes: set[str] = set()
    if db.scalars(
        select(AwsAccount.id).where(
            AwsAccount.org_id == org_id, AwsAccount.status == "connected"
        ).limit(1)
    ).first():
        prefixes.add("__aws__")
    if db.scalars(
        select(AzureSubscription.id).where(
            AzureSubscription.org_id == org_id, AzureSubscription.status == "connected"
        ).limit(1)
    ).first():
        prefixes.update(_PROVIDER_PREFIXES["azure"])
    if db.scalars(
        select(GcpProject.id).where(GcpProject.org_id == org_id, GcpProject.status == "connected").limit(1)
    ).first():
        prefixes.update(_PROVIDER_PREFIXES["gcp"])
    providers = db.scalars(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id, IdentityProvider.status == "connected"
        )
    ).all()
    for provider in providers:
        prefixes.update(_PROVIDER_PREFIXES.get(provider.type, ()))
    return prefixes


def _check_matches_connected_scope(check_id: str, active_provider_prefixes: set[str]) -> bool:
    all_external_prefixes = tuple(
        prefix for prefixes in _PROVIDER_PREFIXES.values() for prefix in prefixes
    )
    if not check_id.startswith(all_external_prefixes):
        return "__aws__" in active_provider_prefixes
    return check_id.startswith(tuple(active_provider_prefixes)) if active_provider_prefixes else False


def _checks_for_domain(section_key: str, control_results: list[dict[str, Any]]) -> set[str]:
    checks: set[str] = set()
    for control in control_results:
        for cid in (control.get("check_evidence_classes") or {}):
            if domain_for_check(cid) == section_key:
                checks.add(cid)
        for f in (control.get("findings") or []) + (control.get("exceptions") or []):
            fcid = f.get("check_id")
            if fcid and domain_for_check(fcid) == section_key:
                checks.add(fcid)
    return checks


def _checklist_items_for_domain(
    section_key: str,
    control_results: list[dict[str, Any]],
    *,
    framework: str,
    named_sources: list[str],
    scanned_entity_types: set[str] | None,
) -> list[dict[str, Any]]:
    """Return curated service/capability rows rather than exposing the raw check registry."""
    check_controls: dict[str, set[str]] = {}
    gaps_by_check: dict[str, list[dict[str, Any]]] = {}
    exceptions_by_check: dict[str, list[dict[str, Any]]] = {}
    for control in control_results:
        control_id = str(control.get("control_id") or "")
        for check_id in control.get("check_evidence_classes") or {}:
            if domain_for_check(check_id) == section_key:
                check_controls.setdefault(check_id, set()).add(control_id)
        for key, target in (("findings", gaps_by_check), ("exceptions", exceptions_by_check)):
            for finding in control.get(key) or []:
                check_id = str(finding.get("check_id") or "")
                if check_id and domain_for_check(check_id) == section_key:
                    target.setdefault(check_id, []).append(finding)
                    check_controls.setdefault(check_id, set()).add(control_id)

    observed_check_ids = set(gaps_by_check) | set(exceptions_by_check)
    items: list[dict[str, Any]] = []
    definitions = [d for d in _AUDIT_CAPABILITIES if d["domain"] == section_key]
    matched_check_ids = {
        check_id
        for definition in definitions
        for check_id in check_controls
        if check_id in set(definition.get("checks") or ())
        or (
            definition.get("prefixes")
            and check_id.startswith(tuple(definition["prefixes"]))
        )
    }
    definitions.extend(
        [
            {
                "key": check_id,
                "label": (
                    CHECK_VERIFIED_PHRASES.get(check_id)
                    or check_id.replace(".", " ").replace("_", " ")
                ).capitalize(),
                "checks": (check_id,),
            }
            for check_id in sorted(set(check_controls) - matched_check_ids)
        ]
    )
    for definition in definitions:
        configured = set(definition.get("checks") or ())
        prefixes = tuple(definition.get("prefixes") or ())
        check_ids = sorted(
            check_id
            for check_id in check_controls
            if check_id in configured or (prefixes and check_id.startswith(prefixes))
        )
        if not check_ids:
            continue
        gaps = [finding for check_id in check_ids for finding in gaps_by_check.get(check_id, [])]
        exceptions = [
            finding for check_id in check_ids for finding in exceptions_by_check.get(check_id, [])
        ]
        applicability_reason = _applicability_reason(
            check_ids, scanned_entity_types, observed_check_ids
        )
        absence_gaps = [
            gap
            for gap in gaps
            if str(gap.get("check_id") or "").endswith(
                (".not_enabled", ".not_detected", ".missing")
            )
        ]
        state = (
            "not_applicable"
            if applicability_reason
            else "action"
            if gaps
            else "verified"
        )
        ranked_gaps = sorted(
            gaps,
            key=lambda finding: (
                _SEVERITY_ORDER.get(str(finding.get("severity") or "").lower(), 9),
                str(finding.get("title") or ""),
            ),
        )
        highest_severity = str(ranked_gaps[0].get("severity") or "").lower() if ranked_gaps else None
        resources = sorted(
            {
                _resource_label(str(entry.get("resource_arn") or ""))
                for entry in gaps + exceptions
                if _resource_label(str(entry.get("resource_arn") or ""))
            }
        )
        items.append(
            {
                "key": definition["key"],
                "check_id": check_ids[0],
                "check_ids": check_ids,
                "label": definition["label"],
                "status": state,
                "controls": [
                    _framework_control_tag(framework, control_id)
                    for control_id in sorted(
                        {control for check_id in check_ids for control in check_controls[check_id]}
                    )
                    if control_id
                ],
                "sources": resources or named_sources,
                "finding_count": len(gaps),
                "exception_count": len(exceptions),
                "highest_severity": highest_severity,
                "applicability_reason": applicability_reason,
                "top_findings": [
                    {
                        "title": finding.get("title") or finding.get("check_id"),
                        "severity": str(finding.get("severity") or "unknown").lower(),
                        "resource": _resource_label(str(finding.get("resource_arn") or "")),
                    }
                    for finding in ranked_gaps[:3]
                ],
                "absence_check_ids": sorted(
                    {str(finding.get("check_id")) for finding in absence_gaps if finding.get("check_id")}
                ),
            }
        )
    return items


def _framework_control_tag(framework: str, control_id: str) -> str:
    if framework == "soc2":
        return f"SOC 2 {control_id}"
    if framework == "iso27001":
        return f"ISO 27001 {control_id}"
    if framework == "cis_aws_l1":
        return f"CIS AWS {control_id}"
    return control_id


def _named_sources_for_domain(
    section_key: str,
    control_results: list[dict[str, Any]],
    *,
    account: AwsAccount | None,
) -> list[str]:
    sources: list[str] = []
    if account and section_key != "secure_sdlc":
        label = account.label or account.account_id
        sources.append(f"AWS account {label} ({account.account_id})")
    repos: set[str] = set()
    services: set[str] = set()
    for control in control_results:
        for f in (control.get("findings") or []) + (control.get("exceptions") or []):
            cid = f.get("check_id") or ""
            if domain_for_check(cid) != section_key:
                continue
            arn = f.get("resource_arn") or ""
            if cid.startswith(("github.", "gitlab.")):
                name = _resource_label(arn)
                if name:
                    repos.add(name)
            elif cid.startswith("aws.inspector"):
                services.add("AWS Inspector")
            elif cid.startswith("aws.vulnerability_monitoring"):
                services.add("vulnerability monitoring")
            elif cid.startswith("backup."):
                services.add("AWS Backup")
            elif cid.startswith("rds."):
                services.add("RDS")
    if services:
        sources.append(", ".join(sorted(services)))
    if repos:
        shown = sorted(repos)[:6]
        suffix = f" and {len(repos) - len(shown)} more" if len(repos) > len(shown) else ""
        sources.append(f"{len(repos)} repository/repos ({', '.join(shown)}{suffix})")
    return sources


def _resolved_events_in_period(
    db: Session,
    *,
    account_id: uuid.UUID | None,
    check_ids: set[str],
    since: datetime,
    until: datetime,
) -> list[tuple[FindingEvent, Finding]]:
    if not check_ids:
        return []
    q = (
        select(FindingEvent, Finding)
        .join(Finding, FindingEvent.finding_id == Finding.id)
        .where(
            FindingEvent.action == "resolved",
            FindingEvent.ts >= since,
            FindingEvent.ts <= until,
            Finding.check_id.in_(check_ids),
        )
        .order_by(FindingEvent.ts.desc())
    )
    if account_id:
        q = q.where(with_source_control_for_audit(Finding.account_id == account_id))
    return list(db.execute(q).all())


def _control_ids_for_domain(domain_def: dict[str, Any], control_results: list[dict[str, Any]]) -> list[str]:
    domain_checks = _checks_for_domain(domain_def["key"], control_results)
    if not domain_checks:
        return []
    out: list[str] = []
    for control in control_results:
        mapped = set((control.get("check_evidence_classes") or {}).keys())
        if mapped & domain_checks:
            cid = control.get("control_id")
            if cid:
                out.append(cid)
    return out


def _temporal_from_control_history(
    db: Session,
    account_id: uuid.UUID,
    framework: str,
    control_ids: list[str],
    *,
    days: int,
    domain_label: str,
) -> str | None:
    for control_id in control_ids[:8]:
        try:
            hist = build_control_history(db, account_id, framework, control_id, days)
        except ValueError:
            continue
        segments = hist.get("segments") or []
        fail_span = next((s for s in segments if s.get("status") == "fail"), None)
        if not fail_span:
            continue
        if hist.get("current_status") != "pass":
            fail_from = str(fail_span.get("from", ""))[:10]
            return (
                f"{domain_label} has been failing since {fail_from}; "
                f"{hist.get('open_finding_count', 0)} open finding(s) remain."
            )
        pass_after = next(
            (s for s in segments if s.get("status") == "pass" and s.get("from", "") >= fail_span.get("to", "")),
            None,
        )
        if pass_after:
            fail_from = str(fail_span.get("from", ""))[:10]
            fail_to = str(fail_span.get("to", ""))[:10]
            pass_since = str(pass_after.get("from", ""))[:10]
            return (
                f"{domain_label} was failing {fail_from}–{fail_to}; "
                f"remediated and passing since {pass_since}."
            )
    return None


def build_domain_temporal_sentence(
    db: Session,
    *,
    account: AwsAccount | None,
    framework: str,
    domain_def: dict[str, Any],
    control_results: list[dict[str, Any]],
    since: datetime,
    until: datetime,
    period_days: int,
) -> str | None:
    """One in-period trend/remediation sentence when a material change exists."""
    key = domain_def["key"]
    check_ids = _checks_for_domain(key, control_results)
    if not check_ids:
        return None

    resolved = _resolved_events_in_period(
        db,
        account_id=account.id if account else None,
        check_ids=check_ids,
        since=since,
        until=until,
    )

    if key == "vulnerability_management" and resolved:
        critical = [pair for pair in resolved if (pair[1].severity or "").lower() == "critical"]
        if critical:
            latest = critical[0][0].ts
            open_critical = sum(
                1
                for control in control_results
                for f in control.get("findings") or []
                if f.get("check_id") in _VULN_CHECKS
                and str(f.get("severity", "")).lower() == "critical"
            )
            remediated = len(critical)
            prior = open_critical + remediated
            return (
                f"On {_fmt_date(latest)}, {remediated} critical vulnerabilit"
                f"{'y' if remediated == 1 else 'ies'} remediated, reducing critical count "
                f"from {prior} to {open_critical}."
            )

    if key == "secure_sdlc":
        passing_checks = set()
        for control in control_results:
            for cid in (control.get("check_evidence_classes") or {}):
                if domain_for_check(cid) == key and cid in _SDLC_CHECKS:
                    if not any(f.get("check_id") == cid for f in control.get("findings") or []):
                        passing_checks.add(cid)
        if passing_checks:
            repos = {
                _resource_label(f.get("resource_arn") or "")
                for control in control_results
                for f in (control.get("findings") or []) + (control.get("exceptions") or [])
                if (f.get("check_id") or "").startswith(("github.", "gitlab."))
            }
            repo_count = len({r for r in repos if r}) or None
            parts = []
            if "github.repo.no_branch_protection" in passing_checks or "gitlab.repo.no_branch_protection" in passing_checks:
                parts.append("default branch protection enforced")
            if "github.repo.dependabot_disabled" in passing_checks:
                parts.append("Dependabot enabled")
            if parts:
                repo_phrase = f" across {repo_count} repositories" if repo_count else ""
                return f"SDLC controls verified: {' and '.join(parts)}{repo_phrase}."

    if key == "backup_dr":
        open_gaps = sum(
            1
            for control in control_results
            for f in control.get("findings") or []
            if domain_for_check(f.get("check_id") or "") == key
        )
        passing_dr = any(
            domain_for_check(cid) == key
            for control in control_results
            for cid in (control.get("check_evidence_classes") or {})
            if not any(f.get("check_id") == cid for f in control.get("findings") or [])
        )
        if open_gaps and passing_dr:
            return (
                "Backup and disaster recovery is in progress — some automated checks verified "
                f"while {open_gaps} open gap(s) remain in this domain."
            )

    if resolved:
        latest = resolved[0][0].ts
        count = len(resolved)
        return (
            f"On {_fmt_date(latest)}, {count} finding"
            f"{'' if count == 1 else 's'} in this domain remediated during the audit period."
        )

    if account:
        control_ids = _control_ids_for_domain(domain_def, control_results)
        hist_sentence = _temporal_from_control_history(
            db,
            account.id,
            framework,
            control_ids,
            days=period_days,
            domain_label=domain_def["label"],
        )
        if hist_sentence:
            return hist_sentence
    return None


def build_audit_readiness(
    db: Session,
    org_id: uuid.UUID,
    framework: str,
    *,
    period_days: int = 90,
) -> dict[str, Any]:
    """Structured org-wide audit readiness payload."""
    control_results, account, generated_at = build_org_control_results(db, org_id, framework)
    scanned_entity_types = _latest_org_scanned_entity_types(db, org_id)
    applicable_control_results = _without_inapplicable_checks(
        control_results, scanned_entity_types
    )
    account_label, account_id_str = _org_scope_label(db, org_id, account)
    since = generated_at - timedelta(days=period_days)

    sections = build_domain_sections(
        applicable_control_results,
        framework=framework,
        account_label=account_label,
        account_id=account_id_str,
        generated_at=generated_at,
    )

    sections_by_key = {section.key: section for section in sections}
    domains: list[dict[str, Any]] = []
    for domain_def in DOMAIN_DEFS:
        key = domain_def["key"]
        named_sources = _named_sources_for_domain(key, control_results, account=account)
        checklist_items = _checklist_items_for_domain(
            key,
            control_results,
            framework=framework,
            named_sources=named_sources,
            scanned_entity_types=scanned_entity_types,
        )
        if not checklist_items:
            continue
        section = sections_by_key.get(key)
        if section:
            temporal = build_domain_temporal_sentence(
                db,
                account=account,
                framework=framework,
                domain_def=domain_def,
                control_results=applicable_control_results,
                since=since,
                until=generated_at,
                period_days=period_days,
            )
            check_ids = sorted(_checks_for_domain(key, applicable_control_results))
            domain = domain_section_as_dict(
                section,
                temporal_sentence=temporal,
                named_sources=named_sources,
                check_ids=check_ids,
            )
        else:
            controls = sorted(
                {
                    control
                    for item in checklist_items
                    for control in item.get("controls") or []
                }
            )
            reason = next(
                (
                    item["applicability_reason"]
                    for item in checklist_items
                    if item.get("applicability_reason")
                ),
                "No relevant resources in scope",
            )
            domain = {
                "key": key,
                "label": domain_def["label"],
                "status": "not_applicable",
                "assertion_text": (
                    f"{domain_def['capability']} is not applicable to the current scope. "
                    f"{reason} in the latest successful account scans."
                ),
                "coverage_line": f"Not applicable · {reason.lower()}",
                "verified_phrases": [],
                "gaps": [],
                "exceptions": [],
                "control_tags": controls,
                "evidence_refs": [],
                "checks_total": 0,
                "checks_passing": 0,
                "scope_note": "Automatically derived from the latest successful resource inventories.",
                "temporal_sentence": None,
                "named_sources": named_sources,
                "check_ids": [],
            }
        domain["checklist_items"] = checklist_items
        domains.append(domain)

    org = db.get(Org, org_id)
    return {
        "framework": framework,
        "org_name": (org.name if org else None) or "Organization",
        "as_of": generated_at.isoformat(),
        "period_days": period_days,
        "scope_label": account_label,
        "domains": domains,
    }
