"""Build activity timeline markers for a finding (events + scan confirmations)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Finding, FindingEvent, ScanRun
from app.services.finding_history import STATE_OPEN, finding_state_at, load_events_by_finding

OPEN_EVENTS = frozenset({"opened", "reopened", "recheck_opened"})
EVENT_MARKER_KINDS = OPEN_EVENTS | frozenset({"resolved", "excepted", "ignored", "snoozed"})


def _open_days(finding: Finding, now: datetime) -> int:
    end = finding.resolved_at if finding.status == "resolved" and finding.resolved_at else now
    delta = end - finding.first_seen
    return max(0, delta.days)


def _collapse_scan_markers_by_day(markers: list[dict]) -> list[dict]:
    seen_days: set[str] = set()
    out: list[dict] = []
    for m in markers:
        if m["kind"] != "scan_open":
            out.append(m)
            continue
        day = m["ts"].date().isoformat()
        if day in seen_days:
            continue
        seen_days.add(day)
        out.append(m)
    return out


def build_finding_activity(
    db: Session,
    finding: Finding,
    *,
    days: int = 90,
    max_scan_markers: int = 60,
) -> dict:
    """Return timeline markers for a finding over the last ``days`` days."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=max(1, min(days, 365)))
    window_start = max(since, finding.first_seen)

    events_map = load_events_by_finding(db, [finding.id])
    events = events_map.get(finding.id, [])

    markers: list[dict] = []

    for evt in events:
        if evt.ts < window_start:
            continue
        if evt.action not in EVENT_MARKER_KINDS:
            continue
        markers.append(
            {
                "ts": evt.ts,
                "kind": evt.action,
                "detail": evt.note,
                "scan_run_id": None,
            }
        )

    has_origin = any(m["kind"] in OPEN_EVENTS for m in markers)
    if not has_origin and finding.first_seen >= window_start:
        markers.append(
            {
                "ts": finding.first_seen,
                "kind": "opened",
                "detail": None,
                "scan_run_id": None,
            }
        )

    scans = db.scalars(
        select(ScanRun)
        .where(
            ScanRun.account_id == finding.account_id,
            ScanRun.status == "ok",
            ScanRun.finished_at.isnot(None),
            ScanRun.finished_at >= window_start,
        )
        .order_by(ScanRun.finished_at.asc())
        .limit(max_scan_markers)
    ).all()

    for run in scans:
        ts = run.finished_at
        if ts is None:
            continue
        if finding_state_at(finding, ts, events) == STATE_OPEN:
            markers.append(
                {
                    "ts": ts,
                    "kind": "scan_open",
                    "detail": None,
                    "scan_run_id": run.id,
                }
            )

    markers.sort(key=lambda m: m["ts"])
    markers = _collapse_scan_markers_by_day(markers)

    return {
        "finding_id": str(finding.id),
        "status": finding.status,
        "first_seen": finding.first_seen,
        "last_seen": finding.last_seen,
        "open_days": _open_days(finding, now),
        "markers": markers,
    }
