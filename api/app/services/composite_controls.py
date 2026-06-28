"""Auditor-facing composite control roll-ups from mapped check IDs."""
from __future__ import annotations

import json
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AwsAccount, Finding, Org, ScanRun
from app.services.check_coverage import control_coverage_tier, extended_checks_in_list, tier_display_label, tier_for_check
from app.services.check_evidence import evidence_class_for_check
from app.services.check_settings import hidden_check_ids
from app.services.control_status import (
    DEFAULT_FAIL_SEVERITIES,
    compute_control_status,
    severity_breakdown,
)
from app.services.coverage_overrides import (
    get_coverage_override_details,
    get_coverage_overrides,
)
from app.services.cross_account_coverage import (
    absence_checks,
    cross_account_coverable_checks,
    get_cross_account_coverage,
)

_DEFINITIONS_PATH = Path(__file__).parent.parent.parent / "data" / "composite_controls.json"


@lru_cache(maxsize=1)
def composite_control_definitions() -> list[dict[str, Any]]:
    return json.loads(_DEFINITIONS_PATH.read_text())


def _checks_in_control_mappings() -> set[str]:
    from app.services.check_controls import _mapping_entries

    out: set[str] = set()
    for entry in _mapping_entries():
        out.update(entry.get("checks", []))
    return out


def checks_in_composites() -> set[str]:
    out: set[str] = set()
    for entry in composite_control_definitions():
        out.update(entry.get("checks", []))
    return out


def control_mapping_checks_missing_from_composites() -> list[str]:
    """Checks referenced in control_mappings.json but absent from every composite."""
    return sorted(_checks_in_control_mappings() - checks_in_composites())


def assert_control_mapping_composite_coverage() -> None:
    missing = control_mapping_checks_missing_from_composites()
    if missing:
        raise ValueError(
            "control_mappings.json includes checks with no composite roll-up: "
            + ", ".join(missing)
        )


def soc2_control_checks(control_id: str) -> list[str]:
    from app.services.check_controls import _mapping_entries

    for entry in _mapping_entries():
        if entry.get("framework") == "soc2" and entry.get("control_id") == control_id:
            return list(entry.get("checks", []))
    return []


# Primary composite when a check rolls up to multiple composites (Finding Drawer / by-check API).
_PRIMARY_COMPOSITE_BY_CHECK: dict[str, str] = {
    # Asset inventory (CC6.1) vs broader identity governance
    "iam.user.credentials_unused_45d": "asset_inventory",
    "iam.role.unassumed_90d": "asset_inventory",
    "iam.access_key.unused_45d": "asset_inventory",
    "iam.access_inventory_gap": "asset_inventory",
    "github.org.dormant_members": "asset_inventory",
    "gitlab.org.dormant_members": "asset_inventory",
    "identity_center.user.inactive_90d": "asset_inventory",
    "google_workspace.user.inactive_90d": "asset_inventory",
    "entra.user.inactive_90d": "asset_inventory",
    # Secure SDLC vs change management
    "github.repo.no_branch_protection": "secure_sdlc",
    "gitlab.repo.no_branch_protection": "secure_sdlc",
    "github.repo.no_codeowners": "secure_sdlc",
    "gitlab.repo.no_codeowners": "secure_sdlc",
    "github.repo.self_merge_allowed": "secure_sdlc",
    "gitlab.repo.self_merge_allowed": "secure_sdlc",
    "github.repo.insufficient_reviews": "secure_sdlc",
    "gitlab.repo.insufficient_reviews": "secure_sdlc",
    "github.repo.no_env_protection": "change_management",
    "gitlab.repo.no_env_protection": "change_management",
    # CloudTrail: logging vs change management
    "cloudtrail.trail.not_enabled": "logging_monitoring",
    "cloudtrail.trail.no_log_validation": "logging_monitoring",
    "cloudtrail.event.trail_tampering": "logging_monitoring",
    "cloudtrail.event.lambda_function_created_or_modified": "change_management",
    "cloudtrail.event.rds_instance_created_or_modified": "change_management",
    # Vulnerability: container-scoped vs account-wide
    "aws.vulnerability_monitoring.not_detected": "container_vulnerability_monitoring",
    "ecr.registry.enhanced_scanning_disabled": "container_vulnerability_monitoring",
    "ecr.repository.image_scan_disabled": "container_vulnerability_monitoring",
    "aws.inspector.active_critical_finding": "vulnerability_management",
    # Data protection vs logging for CloudTrail events
    "cloudtrail.event.kms_key_disabled_or_deleted": "data_protection",
    "cloudtrail.event.s3_bucket_policy_change": "data_protection",
    "cloudtrail.event.s3_public_access_block_disabled": "data_protection",
    "cloudtrail.event.security_group_open_to_world": "data_protection",
    "ec2.instance.no_instance_profile": "identity_governance",
    "backup.plan.missing": "backup_resilience",
}


def _infer_primary_composite_id(mapped_id: str) -> str | None:
    matches = [
        entry["id"]
        for entry in composite_control_definitions()
        if mapped_id in entry.get("checks", [])
    ]
    if len(matches) == 1:
        return matches[0]
    return None


def primary_composite_id_for_check(check_id: str) -> str | None:
    from app.services.check_controls import resolve_check_id_for_controls

    mapped_id = resolve_check_id_for_controls(check_id)
    return _PRIMARY_COMPOSITE_BY_CHECK.get(mapped_id) or _infer_primary_composite_id(mapped_id)


def _composite_summary(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": entry["id"],
        "control_id": entry["control_id"],
        "title": entry["title"],
        "description": entry.get("description", ""),
        "guidance": entry.get("guidance"),
        "soc2_criteria": list(entry.get("soc2_criteria") or []),
    }


def composite_defs_for_check(check_id: str) -> list[dict[str, Any]]:
    """Composite control definitions that include this check_id, primary first."""
    from app.services.check_controls import resolve_check_id_for_controls

    mapped_id = resolve_check_id_for_controls(check_id)
    rows: list[dict[str, Any]] = []
    for entry in composite_control_definitions():
        if mapped_id in entry.get("checks", []):
            rows.append(_composite_summary(entry))

    preferred_id = primary_composite_id_for_check(check_id)
    if preferred_id:
        rows.sort(key=lambda r: (0 if r["id"] == preferred_id else 1, r["id"]))
    else:
        rows.sort(key=lambda r: r["id"])
    return rows


def _scan_context(
    db: Session,
    org_id: uuid.UUID,
    account_id: uuid.UUID | None,
    hidden: set[str],
) -> tuple[dict[str, list[Finding]], set[str], set[str], bool, list[dict[str, Any]]]:
    open_by_check: dict[str, list[Finding]] = {}
    latest_checks_run: set[str] = set()
    latest_failed_checks: set[str] = set()
    scan_check_errors: list[dict[str, Any]] = []
    has_scanned_account = False

    if not account_id:
        return open_by_check, latest_checks_run, latest_failed_checks, has_scanned_account, scan_check_errors

    acc = db.get(AwsAccount, account_id)
    if not acc or acc.org_id != org_id:
        return open_by_check, latest_checks_run, latest_failed_checks, has_scanned_account, scan_check_errors

    open_q = select(Finding).where(
        Finding.account_id == account_id,
        Finding.status == "open",
    )
    if hidden:
        open_q = open_q.where(Finding.check_id.notin_(hidden))
    for finding in db.scalars(open_q).all():
        open_by_check.setdefault(finding.check_id, []).append(finding)

    latest_run = db.scalars(
        select(ScanRun)
        .where(
            ScanRun.account_id == account_id,
            ScanRun.status.in_(("ok", "degraded")),
            ScanRun.finished_at.isnot(None),
        )
        .order_by(ScanRun.finished_at.desc())
        .limit(1)
    ).first()
    run_stats = latest_run.stats if latest_run and isinstance(latest_run.stats, dict) else {}
    latest_checks_raw = run_stats.get("checks_run") if isinstance(run_stats, dict) else None
    if isinstance(latest_checks_raw, list):
        latest_checks_run = {str(cid) for cid in latest_checks_raw}
    errors_raw = run_stats.get("check_errors") if isinstance(run_stats, dict) else None
    if isinstance(errors_raw, list):
        for err in errors_raw:
            if isinstance(err, dict) and err.get("check_id"):
                cid = str(err["check_id"])
                latest_failed_checks.add(cid)
                scan_check_errors.append(
                    {
                        "check_id": cid,
                        "error_type": err.get("error_type"),
                        "error": (err.get("error") or "")[:300],
                    }
                )

    has_scanned_account = bool(acc.last_scan_at)
    return open_by_check, latest_checks_run, latest_failed_checks, has_scanned_account, scan_check_errors


_VALID_SEVERITIES = frozenset({"critical", "high", "medium", "low"})


def _fail_severities(settings: dict[str, Any] | None) -> frozenset[str]:
    """Org-configurable severities that fail a control. Defaults to crit/high."""
    raw = (settings or {}).get("compliance_thresholds")
    if isinstance(raw, dict):
        sev = raw.get("fail_severities")
        if isinstance(sev, list):
            valid = {str(s).lower() for s in sev if str(s).lower() in _VALID_SEVERITIES}
            if valid:
                return frozenset(valid)
    return DEFAULT_FAIL_SEVERITIES


def _cross_account_scan_contexts(
    db: Session,
    org_id: uuid.UUID,
    hidden: set[str],
    coverage: dict[str, dict[str, Any]],
) -> dict[str, tuple[dict[str, list[Finding]], set[str]] | None]:
    """For each AWS account referenced by cross-account coverage, return its
    latest (open-finding map, executed-check set), or None if it isn't a
    connected, scanned account in this org. Used to auto-verify that the
    capability is actually on in that account — no manual step."""
    out: dict[str, tuple[dict[str, list[Finding]], set[str]] | None] = {}
    referenced = {d.get("account_id") for d in coverage.values() if d.get("account_id")}
    for acct_num in referenced:
        if not acct_num:
            continue
        acct = db.execute(
            select(AwsAccount).where(
                AwsAccount.org_id == org_id,
                AwsAccount.account_id == acct_num,
                AwsAccount.status == "connected",
            )
        ).scalar_one_or_none()
        if acct is not None and acct.last_scan_at is not None:
            open_by_check, ran, _failed, has_scanned, _errors = _scan_context(
                db, org_id, acct.id, hidden
            )
            out[acct_num] = (open_by_check, ran) if has_scanned else None
        else:
            out[acct_num] = None
    return out


def _cross_account_detail(
    coverage_entry: dict[str, Any] | None,
    check_ids: list[str],
    contexts: dict[str, tuple[dict[str, list[Finding]], set[str]] | None],
) -> dict[str, Any] | None:
    """Augment a stored cross-account entry with a live ``verified`` flag: True
    when the referenced account's latest scan ran the capability's checks and
    found them clean (i.e. the service really is on there)."""
    if not coverage_entry:
        return None
    detail = dict(coverage_entry)
    ctx = contexts.get(detail.get("account_id"))
    verified = False
    if ctx is not None:
        open_by_check, ran = ctx
        # Verify the capability that's actually cross-account coverable.
        targets = cross_account_coverable_checks(check_ids) or absence_checks(check_ids)
        verified = bool(targets) and all(
            (c in ran) and not open_by_check.get(c) for c in targets
        )
    detail["verified"] = verified
    return detail


def list_composite_controls(
    db: Session,
    org_id: uuid.UUID,
    account_id: uuid.UUID | None,
) -> list[dict[str, Any]]:
    org = db.get(Org, org_id)
    fail_severities = _fail_severities(org.settings if org else {})
    hidden = hidden_check_ids(org.settings if org else {})
    coverage_overrides = get_coverage_overrides(org.settings if org else {})
    coverage_override_details = get_coverage_override_details(org.settings if org else {})
    cross_account_coverage = get_cross_account_coverage(org.settings if org else {})
    cross_account_ctx = _cross_account_scan_contexts(db, org_id, hidden, cross_account_coverage)
    open_by_check, latest_checks_run, latest_failed_checks, has_scanned_account, scan_check_errors = _scan_context(
        db, org_id, account_id, hidden
    )
    errors_by_check = {e["check_id"]: e for e in scan_check_errors}
    from app.services.sdlc_evidence import sdlc_insights_for_org

    sdlc_insights = sdlc_insights_for_org(db, org_id)

    result: list[dict[str, Any]] = []
    for entry in composite_control_definitions():
        check_ids = [cid for cid in entry.get("checks", []) if cid not in hidden]
        status, open_hits, finding_count = compute_control_status(
            check_ids,
            open_by_check,
            latest_checks_run,
            latest_failed_checks,
            has_scanned_account=has_scanned_account,
            fail_severities=fail_severities,
        )
        cov_tier = control_coverage_tier(check_ids)
        row: dict[str, Any] = {
                "id": entry["id"],
                "control_id": entry["control_id"],
                "title": entry["title"],
                "description": entry.get("description", ""),
                "guidance": entry.get("guidance"),
                "soc2_criteria": list(entry.get("soc2_criteria") or []),
                "check_ids": check_ids,
                "coverage_tier": cov_tier,
                "coverage_label": tier_display_label(cov_tier),
                "extended_check_ids": extended_checks_in_list(check_ids),
                "check_tiers": {cid: tier_for_check(cid) for cid in check_ids},
                "check_evidence_classes": {cid: evidence_class_for_check(cid) for cid in check_ids},
                "status": status,
                "finding_count": finding_count,
                "severity_counts": severity_breakdown(open_hits),
                "open_finding_ids": [str(f.id) for f in open_hits],
                "scan_errors": [errors_by_check[cid] for cid in check_ids if cid in errors_by_check],
                "coverage_override": coverage_overrides.get(entry["id"]),
                "coverage_override_detail": coverage_override_details.get(entry["id"]),
                "cross_account_coverage_detail": _cross_account_detail(
                    cross_account_coverage.get(entry["id"]), check_ids, cross_account_ctx
                ),
            }
        if entry["id"] == "secure_sdlc":
            row["sdlc_insights"] = sdlc_insights
        result.append(row)
    return result
