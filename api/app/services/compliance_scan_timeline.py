"""Compliance history: scan-level posture summaries plus remediation events."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.sensitive_display import mask_sensitive_text
from app.models import Finding, FindingEvent, ScanRun
from app.models.cloudtrail import CloudTrailEvent
from app.models.control import Control, CheckControl
from app.services.compliance_posture import posture_score_from_counts
from app.services.compliance_timeline import _control_status_at
from app.services.finding_history import (
    finding_open_for_control,
    finding_state_at,
    load_events_by_finding,
)
from app.services.timeline_filters import COMPLIANCE_EVENT_SOURCES


def _control_catalog(db: Session, framework: str) -> list[tuple[Control, list[str]]]:
    controls = db.scalars(
        select(Control).where(Control.framework == framework).order_by(Control.control_id)
    ).all()
    out: list[tuple[Control, list[str]]] = []
    for ctrl in controls:
        check_ids = list(
            db.scalars(select(CheckControl.check_id).where(CheckControl.control_id == ctrl.id)).all()
        )
        out.append((ctrl, check_ids))
    return out


def _snapshot_at(
    *,
    catalog: list[tuple[Control, list[str]]],
    findings: list[Finding],
    events_by_finding: dict,
    scan_runs: list[ScanRun],
    as_of: datetime,
) -> dict[str, dict[str, Any]]:
    has_scan = any(
        (r.finished_at or r.started_at) <= as_of and r.status == "ok" for r in scan_runs
    )
    out: dict[str, dict[str, Any]] = {}
    for ctrl, check_ids in catalog:
        mapped = [f for f in findings if f.check_id in check_ids]
        status = _control_status_at(check_ids, mapped, as_of, has_scan, events_by_finding)
        open_count = sum(
            1
            for f in mapped
            if finding_open_for_control(
                f, finding_state_at(f, as_of, events_by_finding.get(f.id))
            )
        )
        out[ctrl.control_id] = {
            "status": status,
            "title": ctrl.title,
            "open_finding_count": open_count,
        }
    return out


def _counts(snap: dict[str, dict[str, Any]]) -> dict[str, int]:
    return {
        "controls_passed": sum(1 for v in snap.values() if v["status"] == "pass"),
        "controls_failed": sum(1 for v in snap.values() if v["status"] == "fail"),
        "controls_no_data": sum(1 for v in snap.values() if v["status"] == "no_data"),
        "controls_total": len(snap),
    }


def _posture_score(counts: dict[str, int]) -> int | None:
    return posture_score_from_counts(counts)


def _scan_control_diff(
    prev: dict[str, dict[str, Any]],
    curr: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    newly_failed: list[dict[str, Any]] = []
    newly_passed: list[dict[str, Any]] = []
    for cid, cur in curr.items():
        prev_status = prev.get(cid, {}).get("status", "no_data")
        cur_status = cur["status"]
        base = {
            "control_id": cid,
            "title": cur["title"],
            "open_finding_count": cur.get("open_finding_count", 0),
        }
        if prev_status != "fail" and cur_status == "fail":
            newly_failed.append(base)
        elif prev_status == "fail" and cur_status == "pass":
            newly_passed.append(base)
    newly_failed.sort(key=lambda c: c.get("open_finding_count", 0), reverse=True)
    newly_passed.sort(key=lambda c: c.get("open_finding_count", 0), reverse=True)
    return newly_failed, newly_passed


def _snapshot_summary(
    counts: dict[str, int],
    score: int | None,
    *,
    findings_opened: int,
    findings_resolved: int,
    open_findings_count: int,
) -> dict[str, Any]:
    return {
        "posture_score": score,
        "controls_passed": counts["controls_passed"],
        "controls_failed": counts["controls_failed"],
        "controls_no_data": counts["controls_no_data"],
        "findings_opened": findings_opened,
        "findings_resolved": findings_resolved,
        "open_findings_count": open_findings_count,
    }


def _open_findings_count(
    findings: list[Finding],
    events_by_finding: dict,
    as_of: datetime,
) -> int:
    n = 0
    for f in findings:
        state = finding_state_at(f, as_of, events_by_finding.get(f.id))
        if finding_open_for_control(f, state):
            n += 1
    return n


def _infra_event_counts_by_day(
    db: Session,
    account_id: uuid.UUID,
    since: datetime,
) -> dict[str, int]:
    day_col = func.date(CloudTrailEvent.event_time)
    rows = db.execute(
        select(day_col, func.count())
        .where(
            CloudTrailEvent.account_id == account_id,
            CloudTrailEvent.event_time >= since,
            CloudTrailEvent.event_source.in_(tuple(COMPLIANCE_EVENT_SOURCES)),
        )
        .group_by(day_col)
    ).all()
    return {str(row[0]): int(row[1]) for row in rows}


def _attach_infra_counts(events: list[dict[str, Any]], counts: dict[str, int]) -> None:
    """Only surface infra counts when a scan changed control pass/fail (not baseline noise)."""
    for evt in events:
        if evt.get("type") in {"baseline_established", "finding_resolved", "finding_excepted", "finding_reopened"}:
            evt["infrastructure_events_count"] = 0
            continue
        diff = evt.get("diff") or {}
        has_control_flip = bool(diff.get("newly_failed")) or bool(diff.get("newly_passed"))
        if not has_control_flip:
            evt["infrastructure_events_count"] = 0
            continue
        day = evt["timestamp"][:10]
        evt["infrastructure_events_count"] = counts.get(day, 0)


def _period_summary(events: list[dict[str, Any]]) -> dict[str, int]:
    change_events = [e for e in events if e.get("type") != "baseline_established"]
    controls_regressed = 0
    controls_improved = 0
    remediations = 0
    findings_resolved = 0
    for e in change_events:
        controls_regressed += len(e.get("diff", {}).get("newly_failed", []))
        controls_improved += len(e.get("diff", {}).get("newly_passed", []))
        findings_resolved += int(e.get("findings_resolved") or 0)
        if e.get("type") in {"finding_resolved", "finding_excepted"}:
            remediations += 1
    return {
        "compliance_changes": len(change_events),
        "controls_regressed": controls_regressed,
        "controls_improved": controls_improved,
        "remediation_events": remediations,
        "evidence_snapshots": len(events),
        "findings_resolved": findings_resolved,
    }


def _persistent_failing_controls(
    snap: dict[str, dict[str, Any]] | None,
    *,
    limit: int = 5,
) -> list[dict[str, Any]]:
    if not snap:
        return []
    failing = [
        {
            "control_id": cid,
            "title": v["title"],
            "open_finding_count": v.get("open_finding_count", 0),
        }
        for cid, v in snap.items()
        if v.get("status") == "fail"
    ]
    failing.sort(key=lambda c: c.get("open_finding_count", 0), reverse=True)
    return failing[:limit]


def _posture_trend(
    scan_runs: list[ScanRun],
    catalog: list[tuple[Control, list[str]]],
    findings: list[Finding],
    events_by_finding: dict,
) -> list[dict[str, Any]]:
    """One score per successful scan — powers the History chart even when no controls flipped."""
    out: list[dict[str, Any]] = []
    for run in scan_runs:
        ts = run.finished_at or run.started_at
        snap = _snapshot_at(
            catalog=catalog,
            findings=findings,
            events_by_finding=events_by_finding,
            scan_runs=scan_runs,
            as_of=ts,
        )
        score = _posture_score(_counts(snap))
        if score is not None:
            out.append({"timestamp": ts.isoformat(), "posture_score": score})
    return out


def _scan_cadence(scan_runs: list[ScanRun], events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per-day scan counts plus control pass/fail flips (excludes baseline and finding events)."""
    posture_days: dict[str, int] = {}
    for evt in events:
        if evt.get("type") == "baseline_established":
            continue
        if str(evt.get("type", "")).startswith("finding_"):
            continue
        diff = evt.get("diff") or {}
        flips = len(diff.get("newly_failed", [])) + len(diff.get("newly_passed", []))
        if flips == 0:
            continue
        day = evt["timestamp"][:10]
        posture_days[day] = posture_days.get(day, 0) + flips

    days: dict[str, int] = {}
    for run in scan_runs:
        ts = run.finished_at or run.started_at
        day = ts.date().isoformat()
        days[day] = days.get(day, 0) + 1

    return [
        {
            "date": day,
            "scan_count": count,
            "posture_change_count": posture_days.get(day, 0),
        }
        for day, count in sorted(days.items())
    ]


def _top_change(
    *,
    newly_failed: list[dict[str, Any]],
    newly_passed: list[dict[str, Any]],
    score_before: int | None,
    score_after: int | None,
    baseline: bool = False,
) -> dict[str, Any]:
    if baseline:
        return {
            "control_id": None,
            "title": "Initial compliance baseline",
            "direction": "baseline",
            "label": "Initial compliance baseline",
        }
    if score_before is None and score_after is not None:
        return {
            "control_id": None,
            "title": "Initial compliance baseline",
            "direction": "baseline",
            "label": "Initial compliance baseline",
        }
    if newly_passed and (not newly_failed or len(newly_passed) >= len(newly_failed)):
        c = newly_passed[0]
        return {
            "control_id": c["control_id"],
            "title": c["title"],
            "direction": "improved",
            "label": f"{c['control_id']} improved",
        }
    if newly_failed:
        c = newly_failed[0]
        return {
            "control_id": c["control_id"],
            "title": c["title"],
            "direction": "regressed",
            "label": f"{c['control_id']} regressed",
        }
    if score_before is not None and score_after is not None and score_after != score_before:
        verb = "improved" if score_after > score_before else "regressed"
        return {
            "control_id": None,
            "title": "Posture shift",
            "direction": verb,
            "label": f"Score {verb} ({score_before}% → {score_after}%)",
        }
    return {
        "control_id": None,
        "title": "Controls updated",
        "direction": "changed",
        "label": "Control status changed",
    }


def _event_type(
    *,
    newly_failed: list[dict[str, Any]],
    newly_passed: list[dict[str, Any]],
    score_before: int | None,
    score_after: int | None,
) -> str:
    if score_before is not None and score_after is not None:
        if score_after < score_before and not newly_passed:
            return "compliance_regressed"
        if score_after > score_before and not newly_failed:
            return "compliance_improved"
    if len(newly_failed) > len(newly_passed):
        return "compliance_regressed"
    if len(newly_passed) > len(newly_failed):
        return "compliance_improved"
    return "scan_with_changes"


def _events_excluding(
    events_by_finding: dict[uuid.UUID, list[FindingEvent]],
    skip: FindingEvent,
) -> dict[uuid.UUID, list[FindingEvent]]:
    return {
        fid: [e for e in evts if e.id != skip.id]
        for fid, evts in events_by_finding.items()
    }


def _control_check_ids(
    catalog: list[tuple[Control, list[str]]],
    control_id: str,
) -> tuple[list[str], str]:
    for ctrl, check_ids in catalog:
        if ctrl.control_id == control_id:
            return check_ids, ctrl.title
    return [], ""


def _open_findings_for_control(
    check_ids: list[str],
    findings: list[Finding],
    as_of: datetime,
    events_by_finding: dict[uuid.UUID, list[FindingEvent]],
) -> int:
    n = 0
    for f in findings:
        if f.check_id not in check_ids:
            continue
        state = finding_state_at(f, as_of, events_by_finding.get(f.id))
        if finding_open_for_control(f, state):
            n += 1
    return n


def _control_flip_for_finding_event(
    *,
    catalog: list[tuple[Control, list[str]]],
    control_id: str,
    title: str,
    findings: list[Finding],
    events_by_finding: dict[uuid.UUID, list[FindingEvent]],
    scan_runs: list[ScanRun],
    evt: FindingEvent,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """True pass/fail flip only — resolving one finding must not pass a control with other open findings."""
    check_ids, ctrl_title = _control_check_ids(catalog, control_id)
    if not check_ids:
        return [], []

    mapped = [f for f in findings if f.check_id in check_ids]
    ts = evt.ts
    has_scan = any((r.finished_at or r.started_at) <= ts and r.status == "ok" for r in scan_runs)
    before = _control_status_at(
        check_ids, mapped, ts, has_scan, _events_excluding(events_by_finding, evt)
    )
    after = _control_status_at(check_ids, mapped, ts, has_scan, events_by_finding)
    open_count = _open_findings_for_control(check_ids, mapped, ts, events_by_finding)
    base = {
        "control_id": control_id,
        "title": title or ctrl_title,
        "open_finding_count": open_count,
    }
    if before != "fail" and after == "fail":
        return [base], []
    if before == "fail" and after == "pass":
        return [], [base]
    return [], []


def _finding_control_lookup(db: Session, framework: str, findings: list[Finding]) -> dict[uuid.UUID, dict[str, Any]]:
    from app.services.check_controls import controls_for_check

    check_ids = sorted({f.check_id for f in findings})
    if not check_ids:
        return {}
    rows = db.execute(
        select(CheckControl.check_id, Control.control_id, Control.title)
        .join(Control, CheckControl.control_id == Control.id)
        .where(Control.framework == framework, CheckControl.check_id.in_(check_ids))
    ).all()
    by_check: dict[str, dict[str, Any]] = {}
    for check_id, control_id, title in rows:
        by_check.setdefault(check_id, {"control_id": control_id, "title": title})
    for finding in findings:
        if finding.check_id in by_check:
            continue
        for row in controls_for_check(finding.check_id):
            if row["framework"] == framework:
                by_check[finding.check_id] = {
                    "control_id": row["control_id"],
                    "title": row["title"],
                }
                break
    return {f.id: by_check[f.check_id] for f in findings if f.check_id in by_check}


def _finding_events(
    db: Session,
    *,
    account_id: uuid.UUID,
    framework: str,
    findings: list[Finding],
    since: datetime,
    limit: int,
    catalog: list[tuple[Control, list[str]]],
    scan_runs: list[ScanRun],
    events_by_finding: dict[uuid.UUID, list[FindingEvent]],
) -> list[dict[str, Any]]:
    finding_ids = [f.id for f in findings]
    if not finding_ids:
        return []
    lookup = _finding_control_lookup(db, framework, findings)
    fmap = {f.id: f for f in findings}
    rows = db.scalars(
        select(FindingEvent)
        .where(FindingEvent.finding_id.in_(finding_ids), FindingEvent.ts >= since)
        .where(FindingEvent.action.in_(["resolved", "excepted", "reopened"]))
        .order_by(FindingEvent.ts.desc())
        .limit(limit)
    ).all()
    out: list[dict[str, Any]] = []
    for evt in rows:
        finding = fmap.get(evt.finding_id)
        if not finding:
            continue
        control = lookup.get(evt.finding_id)
        event_type = {
            "resolved": "finding_resolved",
            "excepted": "finding_excepted",
            "reopened": "finding_reopened",
        }.get(evt.action, "finding_updated")
        positive = evt.action in {"resolved", "excepted"}
        newly_failed: list[dict[str, Any]] = []
        newly_passed: list[dict[str, Any]] = []
        if control:
            newly_failed, newly_passed = _control_flip_for_finding_event(
                catalog=catalog,
                control_id=control["control_id"],
                title=control["title"],
                findings=findings,
                events_by_finding=events_by_finding,
                scan_runs=scan_runs,
                evt=evt,
            )
        if newly_passed:
            change_direction = "improved"
        elif newly_failed:
            change_direction = "regressed"
        else:
            change_direction = "improved" if positive else "regressed"

        snap_after = _snapshot_at(
            catalog=catalog,
            findings=findings,
            events_by_finding=events_by_finding,
            scan_runs=scan_runs,
            as_of=evt.ts,
        )
        snap_before = _snapshot_at(
            catalog=catalog,
            findings=findings,
            events_by_finding=_events_excluding(events_by_finding, evt),
            scan_runs=scan_runs,
            as_of=evt.ts,
        )
        after_counts = _counts(snap_after)
        before_counts = _counts(snap_before)
        score_after = _posture_score(after_counts)
        score_before = _posture_score(before_counts)

        out.append(
            {
                "type": event_type,
                "timestamp": evt.ts.isoformat(),
                "scan_run_id": f"event-{evt.id}",
                "framework": framework,
                "posture_before": score_before,
                "posture_after": score_after,
                "controls_failed_before": before_counts["controls_failed"],
                "controls_failed_after": after_counts["controls_failed"],
                "controls_passed_before": before_counts["controls_passed"],
                "controls_passed_after": after_counts["controls_passed"],
                "new_failures_count": len(newly_failed),
                "resolved_count": len(newly_passed),
                "findings_opened": 0 if positive else 1,
                "findings_resolved": 1 if positive else 0,
                "resource_arn": finding.resource_arn,
                "check_id": finding.check_id,
                "detail": mask_sensitive_text(evt.note or finding.title),
                "snapshot": _snapshot_summary(
                    after_counts,
                    score_after,
                    findings_opened=0 if positive else 1,
                    findings_resolved=1 if positive else 0,
                    open_findings_count=_open_findings_count(findings, events_by_finding, evt.ts),
                ),
                "top_change": {
                    "control_id": control.get("control_id") if control else None,
                    "title": mask_sensitive_text(
                        control.get("title") if control else finding.title
                    ),
                    "direction": change_direction,
                    "label": "Finding resolved" if evt.action == "resolved" else "Exception recorded" if evt.action == "excepted" else "Finding reopened",
                },
                "diff": {
                    "newly_failed": newly_failed,
                    "newly_passed": newly_passed,
                },
            }
        )
    return out


def build_compliance_scan_timeline(
    db: Session,
    account_id: uuid.UUID,
    framework: str,
    days: int = 90,
    limit: int = 40,
) -> dict[str, Any]:
    """One history entry per scan that changed compliance posture, plus resolved finding events."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    catalog = _control_catalog(db, framework)
    if not catalog:
        return {
            "framework": framework,
            "period_days": days,
            "events": [],
            "period_summary": {
                "compliance_changes": 0,
                "controls_regressed": 0,
                "controls_improved": 0,
                "remediation_events": 0,
                "evidence_snapshots": 0,
                "findings_resolved": 0,
            },
            "current_summary": None,
            "current_posture_score": None,
            "total_failing": 0,
            "scan_count": 0,
            "scan_cadence": [],
            "posture_trend": [],
            "persistent_gaps": [],
        }

    findings = list(db.scalars(select(Finding).where(Finding.account_id == account_id)).all())
    events_by_finding = load_events_by_finding(db, [f.id for f in findings])

    scan_runs = db.scalars(
        select(ScanRun)
        .where(
            ScanRun.account_id == account_id,
            ScanRun.started_at >= since,
            ScanRun.status == "ok",
        )
        .order_by(ScanRun.started_at.asc())
    ).all()

    events: list[dict[str, Any]] = []
    prev_snap: dict[str, dict[str, Any]] | None = None
    last_snap: dict[str, dict[str, Any]] | None = None

    for run in scan_runs:
        ts = run.finished_at or run.started_at
        snap = _snapshot_at(
            catalog=catalog,
            findings=findings,
            events_by_finding=events_by_finding,
            scan_runs=scan_runs,
            as_of=ts,
        )
        last_snap = snap
        curr_counts = _counts(snap)
        score_after = _posture_score(curr_counts)

        if prev_snap is None:
            baseline_failed = [
                {
                    "control_id": cid,
                    "title": v["title"],
                    "open_finding_count": v.get("open_finding_count", 0),
                }
                for cid, v in sorted(snap.items())
                if v["status"] == "fail"
            ]
            baseline_failed.sort(key=lambda c: c.get("open_finding_count", 0), reverse=True)
            findings_discovered = _open_findings_count(findings, events_by_finding, ts)
            events.append(
                {
                    "type": "baseline_established",
                    "timestamp": ts.isoformat(),
                    "scan_run_id": str(run.id),
                    "framework": framework,
                    "posture_before": None,
                    "posture_after": score_after,
                    "controls_failed_before": None,
                    "controls_failed_after": curr_counts["controls_failed"],
                    "controls_passed_before": None,
                    "controls_passed_after": curr_counts["controls_passed"],
                    "new_failures_count": curr_counts["controls_failed"],
                    "resolved_count": 0,
                    "findings_opened": run.findings_opened,
                    "findings_resolved": run.findings_resolved,
                    "findings_discovered": findings_discovered,
                    "snapshot": _snapshot_summary(
                        curr_counts,
                        score_after,
                        findings_opened=run.findings_opened,
                        findings_resolved=run.findings_resolved,
                        open_findings_count=findings_discovered,
                    ),
                    "top_change": _top_change(
                        newly_failed=baseline_failed,
                        newly_passed=[],
                        score_before=None,
                        score_after=score_after,
                        baseline=True,
                    ),
                    "diff": {
                        "newly_failed": baseline_failed,
                        "newly_passed": [],
                    },
                }
            )
            prev_snap = snap
            continue

        prev_counts = _counts(prev_snap)
        score_before = _posture_score(prev_counts)
        newly_failed, newly_passed = _scan_control_diff(prev_snap, snap)

        if not newly_failed and not newly_passed:
            prev_snap = snap
            continue

        evt_type = _event_type(
            newly_failed=newly_failed,
            newly_passed=newly_passed,
            score_before=score_before,
            score_after=score_after,
        )

        events.append(
            {
                "type": evt_type,
                "timestamp": ts.isoformat(),
                "scan_run_id": str(run.id),
                "framework": framework,
                "posture_before": score_before,
                "posture_after": score_after,
                "controls_failed_before": prev_counts["controls_failed"],
                "controls_failed_after": curr_counts["controls_failed"],
                "controls_passed_before": prev_counts["controls_passed"],
                "controls_passed_after": curr_counts["controls_passed"],
                "new_failures_count": len(newly_failed),
                "resolved_count": len(newly_passed),
                "findings_opened": run.findings_opened,
                "findings_resolved": run.findings_resolved,
                "snapshot": _snapshot_summary(
                    curr_counts,
                    score_after,
                    findings_opened=run.findings_opened,
                    findings_resolved=run.findings_resolved,
                    open_findings_count=_open_findings_count(findings, events_by_finding, ts),
                ),
                "top_change": _top_change(
                    newly_failed=newly_failed,
                    newly_passed=newly_passed,
                    score_before=score_before,
                    score_after=score_after,
                ),
                "diff": {
                    "newly_failed": newly_failed,
                    "newly_passed": newly_passed,
                },
            }
        )
        prev_snap = snap

    events.extend(
        _finding_events(
            db,
            account_id=account_id,
            framework=framework,
            findings=findings,
            since=since,
            limit=limit,
            catalog=catalog,
            scan_runs=scan_runs,
            events_by_finding=events_by_finding,
        )
    )
    events.sort(key=lambda e: e["timestamp"], reverse=True)
    events = events[:limit]

    infra_counts = _infra_event_counts_by_day(db, account_id, since)
    _attach_infra_counts(events, infra_counts)

    current_summary = None
    current_posture_score = None
    total_failing = 0
    if last_snap:
        current_summary = _counts(last_snap)
        current_posture_score = _posture_score(current_summary)
        total_failing = current_summary["controls_failed"]
        if scan_runs:
            as_of = scan_runs[-1].finished_at or scan_runs[-1].started_at
            current_summary["open_findings_count"] = _open_findings_count(
                findings, events_by_finding, as_of
            )

    return {
        "framework": framework,
        "period_days": days,
        "events": events,
        "period_summary": _period_summary(events),
        "current_summary": current_summary,
        "current_posture_score": current_posture_score,
        "total_failing": total_failing,
        "persistent_gaps": _persistent_failing_controls(last_snap),
        "scan_count": len(scan_runs),
        "scan_cadence": _scan_cadence(scan_runs, events),
        "posture_trend": _posture_trend(scan_runs, catalog, findings, events_by_finding),
    }
