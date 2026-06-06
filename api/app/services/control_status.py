"""Shared pass/fail/no_data logic for controls and composite roll-ups."""
from __future__ import annotations

from app.models import Finding
from app.services.finding_history import finding_open_for_control


def compute_control_status(
    check_ids: list[str],
    open_by_check: dict[str, list[Finding]],
    latest_checks_run: set[str],
    latest_failed_checks: set[str],
    *,
    has_scanned_account: bool,
) -> tuple[str, list[Finding], int]:
    """Return (status, open findings, finding_count) for a set of mapped check IDs."""
    hits: list[Finding] = []
    for cid in check_ids:
        hits.extend(open_by_check.get(cid, []))

    check_id_set = set(check_ids)
    all_mapped_checks_ran = bool(check_id_set) and check_id_set.issubset(latest_checks_run)
    any_mapped_check_failed = bool(check_id_set & latest_failed_checks)

    if not check_ids:
        status = "no_data"
    elif any(finding_open_for_control(f, f.status) for f in hits):
        status = "fail"
    elif has_scanned_account and all_mapped_checks_ran and not any_mapped_check_failed:
        status = "pass"
    else:
        status = "no_data"

    open_hits = [f for f in hits if finding_open_for_control(f, f.status)]
    return status, open_hits, len(open_hits)
