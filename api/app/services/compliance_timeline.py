"""Control pass/fail history derived from findings and scan runs."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Finding, FindingEvent, ScanRun
from app.models.control import Control, CheckControl
from app.services.check_evidence import CLASS_BENCHMARK, evidence_class_for_check
from app.services.finding_history import (
    finding_open_for_control,
    finding_state_at,
    load_events_by_finding,
)


def _control_status_at(
    check_ids: list[str],
    findings: list[Finding],
    t: datetime,
    has_scan_before: bool,
    events_by_finding: dict,
) -> str:
    if not check_ids:
        return "no_data"
    if not has_scan_before:
        return "no_data"
    for f in findings:
        if f.check_id not in check_ids:
            continue
        state = finding_state_at(f, t, events_by_finding.get(f.id))
        if finding_open_for_control(f, state):
            return "fail"
    return "pass"


def build_control_history(
    db: Session,
    account_id: uuid.UUID,
    framework: str,
    control_id: str,
    days: int = 90,
) -> dict[str, Any]:
    ctrl = db.scalars(
        select(Control).where(Control.framework == framework, Control.control_id == control_id)
    ).first()
    if not ctrl:
        raise ValueError("control not found")

    check_ids = list(
        db.scalars(select(CheckControl.check_id).where(CheckControl.control_id == ctrl.id)).all()
    )
    since = datetime.now(timezone.utc) - timedelta(days=days)
    now = datetime.now(timezone.utc)

    findings = db.scalars(
        select(Finding).where(Finding.account_id == account_id)
    ).all()
    mapped_findings = [f for f in findings if f.check_id in check_ids]
    events_by_finding = load_events_by_finding(db, [f.id for f in mapped_findings])

    scan_runs = db.scalars(
        select(ScanRun)
        .where(ScanRun.account_id == account_id, ScanRun.started_at >= since)
        .order_by(ScanRun.started_at.asc())
    ).all()

    # Boundary timestamps for segment computation
    boundaries: set[datetime] = {since, now}
    for run in scan_runs:
        ts = run.finished_at or run.started_at
        boundaries.add(ts)
    for f in mapped_findings:
        if f.first_seen >= since:
            boundaries.add(f.first_seen)
        if f.resolved_at and f.resolved_at >= since:
            boundaries.add(f.resolved_at)

    sorted_bounds = sorted(boundaries)
    segments: list[dict[str, Any]] = []
    for i, start in enumerate(sorted_bounds[:-1]):
        end = sorted_bounds[i + 1]
        if end <= start:
            continue
        mid = start + (end - start) / 2
        has_scan = any(
            (r.finished_at or r.started_at) <= mid and r.status == "ok"
            for r in scan_runs
        )
        status = _control_status_at(check_ids, mapped_findings, mid, has_scan, events_by_finding)
        if segments and segments[-1]["status"] == status:
            segments[-1]["to"] = end.isoformat()
            segments[-1]["duration_seconds"] = int(
                (end - datetime.fromisoformat(segments[-1]["from"].replace("Z", "+00:00"))).total_seconds()
            )
        else:
            segments.append({
                "status": status,
                "from": start.isoformat(),
                "to": end.isoformat(),
                "duration_seconds": int((end - start).total_seconds()),
            })

    current_status = _control_status_at(
        check_ids,
        mapped_findings,
        now,
        any(r.status == "ok" for r in scan_runs),
        events_by_finding,
    )

    open_findings = [
        f for f in mapped_findings
        if finding_open_for_control(f, finding_state_at(f, now, events_by_finding.get(f.id)))
    ]
    failing_since: datetime | None = None
    if open_findings:
        failing_since = min(f.first_seen for f in open_findings)
    days_failing: int | None = None
    if failing_since:
        days_failing = max(0, (now - failing_since).days)

    events: list[dict[str, Any]] = []
    for run in scan_runs:
        ts = run.finished_at or run.started_at
        events.append({
            "timestamp": ts.isoformat(),
            "type": "scan_completed" if run.status == "ok" else f"scan_{run.status}",
            "detail": f"Scan {run.status}; +{run.findings_opened} / -{run.findings_resolved} findings",
        })

    finding_ids = [f.id for f in mapped_findings]
    if finding_ids:
        fevents = db.scalars(
            select(FindingEvent)
            .where(FindingEvent.finding_id.in_(finding_ids), FindingEvent.ts >= since)
            .order_by(FindingEvent.ts.asc())
        ).all()
        fmap = {f.id: f for f in mapped_findings}
        for evt in fevents:
            f = fmap.get(evt.finding_id)
            if not f:
                continue
            events.append({
                "timestamp": evt.ts.isoformat(),
                "type": f"finding_{evt.action}",
                "finding_id": str(f.id),
                "finding_status": finding_state_at(f, now, events_by_finding.get(f.id)),
                "affects_control_status": evidence_class_for_check(f.check_id) == CLASS_BENCHMARK,
                "check_id": f.check_id,
                "resource_arn": f.resource_arn,
                "detail": evt.note or f.title,
            })

    for f in mapped_findings:
        if f.first_seen >= since:
            events.append({
                "timestamp": f.first_seen.isoformat(),
                "type": "finding_detected",
                "finding_id": str(f.id),
                "finding_status": finding_state_at(f, now, events_by_finding.get(f.id)),
                "affects_control_status": evidence_class_for_check(f.check_id) == CLASS_BENCHMARK,
                "check_id": f.check_id,
                "resource_arn": f.resource_arn,
                "detail": f.title,
            })

    events.sort(key=lambda e: e["timestamp"])

    return {
        "control_id": control_id,
        "framework": framework,
        "title": ctrl.title,
        "current_status": current_status,
        "period_days": days,
        "failing_since": failing_since.isoformat() if failing_since else None,
        "days_failing": days_failing,
        "open_finding_count": len(open_findings),
        "segments": segments,
        "events": events,
    }


def _segments_for_control(
    check_ids: list[str],
    mapped_findings: list[Finding],
    events_by_finding: dict,
    scan_runs: list[ScanRun],
    since: datetime,
    now: datetime,
) -> list[dict[str, Any]]:
    """Status segments for one control, from preloaded account data."""
    boundaries: set[datetime] = {since, now}
    for run in scan_runs:
        boundaries.add(run.finished_at or run.started_at)
    for f in mapped_findings:
        if f.first_seen >= since:
            boundaries.add(f.first_seen)
        if f.resolved_at and f.resolved_at >= since:
            boundaries.add(f.resolved_at)

    sorted_bounds = sorted(boundaries)
    # Accumulate as (status, start, end) tuples; serialize once at the end.
    spans: list[tuple[str, datetime, datetime]] = []
    for i, start in enumerate(sorted_bounds[:-1]):
        end = sorted_bounds[i + 1]
        if end <= start:
            continue
        mid = start + (end - start) / 2
        has_scan = any(
            (r.finished_at or r.started_at) <= mid and r.status == "ok"
            for r in scan_runs
        )
        status = _control_status_at(check_ids, mapped_findings, mid, has_scan, events_by_finding)
        if spans and spans[-1][0] == status:
            spans[-1] = (status, spans[-1][1], end)
        else:
            spans.append((status, start, end))

    return [
        {
            "status": status,
            "from": start.isoformat(),
            "to": end.isoformat(),
            "duration_seconds": int((end - start).total_seconds()),
        }
        for status, start, end in spans
    ]


def build_framework_history(
    db: Session,
    account_id: uuid.UUID,
    framework: str,
    days: int = 90,
) -> dict[str, Any]:
    """Per-control pass/fail segments for every control in a framework.

    Loads account findings, finding events, and scan runs once, then computes
    each control's timeline from the shared data — unlike calling
    ``build_control_history`` per control, which would reload everything N times.
    """
    controls = db.scalars(
        select(Control).where(Control.framework == framework).order_by(Control.control_id)
    ).all()
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    base: dict[str, Any] = {
        "framework": framework,
        "period_days": days,
        "from": since.isoformat(),
        "to": now.isoformat(),
        "controls": [],
    }
    if not controls:
        return base

    mappings = db.execute(
        select(CheckControl.control_id, CheckControl.check_id).where(
            CheckControl.control_id.in_([c.id for c in controls])
        )
    ).all()
    checks_by_control: dict[uuid.UUID, list[str]] = {}
    for control_pk, check_id in mappings:
        checks_by_control.setdefault(control_pk, []).append(check_id)

    all_check_ids = {cid for ids in checks_by_control.values() for cid in ids}
    findings = db.scalars(select(Finding).where(Finding.account_id == account_id)).all()
    findings_by_check: dict[str, list[Finding]] = {}
    for f in findings:
        if f.check_id in all_check_ids:
            findings_by_check.setdefault(f.check_id, []).append(f)

    events_by_finding = load_events_by_finding(
        db, [f.id for fs in findings_by_check.values() for f in fs]
    )
    scan_runs = db.scalars(
        select(ScanRun)
        .where(ScanRun.account_id == account_id, ScanRun.started_at >= since)
        .order_by(ScanRun.started_at.asc())
    ).all()
    any_ok_scan = any(r.status == "ok" for r in scan_runs)

    for ctrl in controls:
        check_ids = checks_by_control.get(ctrl.id, [])
        mapped = [f for cid in check_ids for f in findings_by_check.get(cid, [])]
        current_status = _control_status_at(
            check_ids, mapped, now, any_ok_scan, events_by_finding
        )
        open_findings = [
            f for f in mapped
            if finding_open_for_control(f, finding_state_at(f, now, events_by_finding.get(f.id)))
        ]
        failing_since = min((f.first_seen for f in open_findings), default=None)
        base["controls"].append({
            "control_id": ctrl.control_id,
            "title": ctrl.title,
            "check_ids": check_ids,
            "current_status": current_status,
            "failing_since": failing_since.isoformat() if failing_since else None,
            "days_failing": max(0, (now - failing_since).days) if failing_since else None,
            "open_finding_count": len(open_findings),
            "segments": _segments_for_control(
                check_ids, mapped, events_by_finding, scan_runs, since, now
            ),
        })

    return base


def build_compliance_timeline(
    db: Session,
    account_id: uuid.UUID,
    framework: str,
    days: int = 90,
    limit: int = 100,
) -> dict[str, Any]:
    """Aggregate control status changes across all controls in a framework."""
    controls = db.scalars(
        select(Control).where(Control.framework == framework).order_by(Control.control_id)
    ).all()

    entries: list[dict[str, Any]] = []
    failing_controls: list[dict[str, Any]] = []

    for ctrl in controls[:limit]:
        try:
            hist = build_control_history(db, account_id, framework, ctrl.control_id, days)
        except ValueError:
            continue

        if hist["current_status"] == "fail":
            failing_controls.append({
                "control_id": ctrl.control_id,
                "title": ctrl.title,
                "days_failing": hist["days_failing"],
                "open_finding_count": hist["open_finding_count"],
            })

        for evt in hist["events"]:
            entries.append({
                **evt,
                "control_id": ctrl.control_id,
                "control_title": ctrl.title,
            })

        if hist["current_status"] == "fail" and hist["failing_since"]:
            entries.append({
                "timestamp": hist["failing_since"],
                "type": "control_failing",
                "control_id": ctrl.control_id,
                "control_title": ctrl.title,
                "detail": f"{hist['open_finding_count']} open finding(s); failing for {hist['days_failing']} days",
            })
        elif hist["current_status"] == "pass":
            entries.append({
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "type": "control_passing",
                "control_id": ctrl.control_id,
                "control_title": ctrl.title,
                "detail": "No open findings mapped to this control",
            })

    entries.sort(key=lambda e: e["timestamp"], reverse=True)
    return {
        "framework": framework,
        "period_days": days,
        "entries": entries[:limit],
        "failing_controls": sorted(
            failing_controls,
            key=lambda c: c.get("days_failing") or 0,
            reverse=True,
        ),
        "total_failing": len(failing_controls),
    }
