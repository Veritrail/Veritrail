"""Org-wide audit readiness narratives — shared builder with the evidence PDF."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AwsAccount, Finding, FindingEvent
from app.models.control import CheckControl, Control
from app.models.org import Org
from app.services.check_settings import hidden_check_ids
from app.services.compliance_timeline import build_control_history
from app.services.evidence_pack import _control_status, _finding_dict
from app.services.finding_history import STATE_EXCEPTED, STATE_OPEN, findings_for_pack_at
from app.services.org_control_mappings import load_org_mapping_index
from app.services.pdf_narrative import (
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
            if cid not in hidden
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
    account_label, account_id_str = _org_scope_label(db, org_id, account)
    since = generated_at - timedelta(days=period_days)

    sections = build_domain_sections(
        control_results,
        framework=framework,
        account_label=account_label,
        account_id=account_id_str,
        generated_at=generated_at,
    )

    domain_defs = {d["key"]: d for d in DOMAIN_DEFS}
    domains: list[dict[str, Any]] = []
    for section in sections:
        domain_def = domain_defs[section.key]
        temporal = build_domain_temporal_sentence(
            db,
            account=account,
            framework=framework,
            domain_def=domain_def,
            control_results=control_results,
            since=since,
            until=generated_at,
            period_days=period_days,
        )
        check_ids = sorted(_checks_for_domain(section.key, control_results))
        named_sources = _named_sources_for_domain(section.key, control_results, account=account)
        domains.append(
            domain_section_as_dict(
                section,
                temporal_sentence=temporal,
                named_sources=named_sources,
                check_ids=check_ids,
            )
        )

    org = db.get(Org, org_id)
    return {
        "framework": framework,
        "org_name": (org.name if org else None) or "Organization",
        "as_of": generated_at.isoformat(),
        "period_days": period_days,
        "scope_label": account_label,
        "domains": domains,
    }
