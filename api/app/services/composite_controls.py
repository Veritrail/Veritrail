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
from app.services.control_status import compute_control_status

_DEFINITIONS_PATH = Path(__file__).parent.parent.parent / "data" / "composite_controls.json"


@lru_cache(maxsize=1)
def composite_control_definitions() -> list[dict[str, Any]]:
    return json.loads(_DEFINITIONS_PATH.read_text())


def _scan_context(
    db: Session,
    org_id: uuid.UUID,
    account_id: uuid.UUID | None,
    hidden: set[str],
) -> tuple[dict[str, list[Finding]], set[str], set[str], bool]:
    open_by_check: dict[str, list[Finding]] = {}
    latest_checks_run: set[str] = set()
    latest_failed_checks: set[str] = set()
    has_scanned_account = False

    if not account_id:
        return open_by_check, latest_checks_run, latest_failed_checks, has_scanned_account

    acc = db.get(AwsAccount, account_id)
    if not acc or acc.org_id != org_id:
        return open_by_check, latest_checks_run, latest_failed_checks, has_scanned_account

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
                latest_failed_checks.add(str(err["check_id"]))

    has_scanned_account = bool(acc.last_scan_at)
    return open_by_check, latest_checks_run, latest_failed_checks, has_scanned_account


def list_composite_controls(
    db: Session,
    org_id: uuid.UUID,
    account_id: uuid.UUID | None,
) -> list[dict[str, Any]]:
    org = db.get(Org, org_id)
    hidden = hidden_check_ids(org.settings if org else {})
    open_by_check, latest_checks_run, latest_failed_checks, has_scanned_account = _scan_context(
        db, org_id, account_id, hidden
    )

    result: list[dict[str, Any]] = []
    for entry in composite_control_definitions():
        check_ids = [cid for cid in entry.get("checks", []) if cid not in hidden]
        status, open_hits, finding_count = compute_control_status(
            check_ids,
            open_by_check,
            latest_checks_run,
            latest_failed_checks,
            has_scanned_account=has_scanned_account,
        )
        cov_tier = control_coverage_tier(check_ids)
        result.append(
            {
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
                "open_finding_ids": [str(f.id) for f in open_hits],
            }
        )
    return result
