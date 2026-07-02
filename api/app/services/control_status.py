"""Shared status logic for controls and composite roll-ups.

A control is graded by the *materiality* of its open findings, not "any finding
fails." For SOC 2 Type II an auditor cares whether the control operates
effectively and exceptions are remediated by severity within SLA:

  - fail    : the control is absent (an absence gap), or has open findings at or
              above the configured fail threshold (default critical/high).
  - at_risk : the control is present; only sub-threshold *medium* findings are
              open (tracked / within SLA).
  - pass    : present, no material or medium findings (low = noted, not failing).
  - no_data : not scanned / not mapped.
"""
from __future__ import annotations

from app.models import Finding
from app.services.finding_history import finding_open_for_control

# Severities that fail a control by default. Org-configurable (e.g. add
# "medium") via settings → compliance_thresholds.fail_severities.
DEFAULT_FAIL_SEVERITIES = frozenset({"critical", "high"})

_ABSENCE_SUFFIXES = (".not_detected", ".not_enabled", ".missing")


def _is_absence_gap(check_id: str) -> bool:
    return check_id.endswith(_ABSENCE_SUFFIXES)


def _open_supporting_activity_hits(hits: list[Finding]) -> list[Finding]:
    """Open supporting/activity findings that never fail via ``finding_open_for_control``.

    Used when a composite cannot otherwise be graded — e.g. Incident Response
    includes Azure/GCP benchmark checks that did not run on a connected AWS
    account, but GuardDuty/Security Hub signals are already open."""
    from app.services.check_evidence import (
        CLASS_ACTIVITY,
        CLASS_SUPPORTING,
        evidence_class_for_check,
    )

    return [
        f
        for f in hits
        if f.status == "open"
        and evidence_class_for_check(f.check_id) in (CLASS_SUPPORTING, CLASS_ACTIVITY)
    ]


def _supporting_only_open_hits(
    check_ids: list[str],
    hits: list[Finding],
) -> list[Finding]:
    """Open supporting/activity findings for controls with *only* supporting checks.

    Used to block a vacuous pass — not for the no_data fallback (see
    ``_open_supporting_activity_hits``)."""
    from app.services.check_evidence import CLASS_BENCHMARK, evidence_class_for_check

    if any(evidence_class_for_check(cid) == CLASS_BENCHMARK for cid in check_ids):
        return []
    return _open_supporting_activity_hits(hits)


def compute_control_status(
    check_ids: list[str],
    open_by_check: dict[str, list[Finding]],
    latest_checks_run: set[str],
    latest_failed_checks: set[str],
    *,
    has_scanned_account: bool,
    fail_severities: frozenset[str] = DEFAULT_FAIL_SEVERITIES,
) -> tuple[str, list[Finding], int]:
    """Return (status, open findings, finding_count) for a set of mapped checks."""
    hits: list[Finding] = []
    for cid in check_ids:
        hits.extend(open_by_check.get(cid, []))

    open_hits = [f for f in hits if finding_open_for_control(f, f.status)]

    # An absent control (service off) is always material, regardless of the
    # check's severity. Everything else is graded by configured threshold.
    material = [
        f
        for f in open_hits
        if (f.severity or "").lower() in fail_severities or _is_absence_gap(f.check_id)
    ]
    warn = [
        f
        for f in open_hits
        if f not in material and (f.severity or "").lower() == "medium"
    ]

    check_id_set = set(check_ids)
    all_mapped_checks_ran = bool(check_id_set) and check_id_set.issubset(latest_checks_run)
    any_mapped_check_failed = bool(check_id_set & latest_failed_checks)

    if not check_ids:
        status = "no_data"
    elif material:
        status = "fail"
    elif warn:
        status = "at_risk"
    elif has_scanned_account and all_mapped_checks_ran and not any_mapped_check_failed:
        status = "pass"
    else:
        supporting_open = _open_supporting_activity_hits(hits)
        if supporting_open:
            status = "at_risk"
            open_hits = supporting_open
        else:
            status = "no_data"

    if status == "pass":
        status, open_hits = _downgrade_supporting_only_pass(check_ids, hits, open_hits)

    return status, open_hits, len(open_hits)


def _downgrade_supporting_only_pass(
    check_ids: list[str],
    hits: list[Finding],
    open_hits: list[Finding],
) -> tuple[str, list[Finding]]:
    """A control whose checks are ALL supporting/activity class can never fail
    through `finding_open_for_control` (benchmark-only), so a bare "pass" would
    be vacuous — e.g. Incident Response showing "Passing" while GuardDuty is
    off. When such a control has open supporting/activity findings, report
    at_risk and surface them. Hygiene-class findings stay cosmetic and never
    affect status."""
    supporting_open = _supporting_only_open_hits(check_ids, hits)
    if not supporting_open:
        return "pass", open_hits
    return "at_risk", supporting_open


def severity_breakdown(open_hits: list[Finding]) -> dict[str, int]:
    """Open-finding counts by severity, for the graded UI + audit context."""
    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for f in open_hits:
        sev = (f.severity or "").lower()
        if sev in counts:
            counts[sev] += 1
    return counts
