from datetime import datetime, timezone
from unittest.mock import MagicMock
import uuid

from app.models import Finding, FindingEvent, ScanRun
from app.models.control import Control
from app.services.compliance_scan_timeline import (
    _control_flip_for_finding_event,
    _period_summary,
    _scan_cadence,
    _top_change,
    build_compliance_scan_timeline,
)


def _ctrl():
    return Control(
        id=uuid.uuid4(),
        framework="soc2",
        control_id="CC6.1",
        title="Logical Access",
        description="",
        guidance="",
    )


def test_history_empty_without_scans():
    db = MagicMock()
    db.scalars.return_value.all.side_effect = [[_ctrl()], ["iam.user.no_mfa"], [], []]
    out = build_compliance_scan_timeline(db, uuid.uuid4(), "soc2", days=30)
    assert out["events"] == []


def test_skips_scans_without_posture_change():
    db = MagicMock()
    ctrl = _ctrl()
    aid = uuid.uuid4()
    t0 = datetime(2026, 5, 29, 8, 0, tzinfo=timezone.utc)
    t1 = datetime(2026, 5, 29, 10, 0, tzinfo=timezone.utc)
    t2 = datetime(2026, 5, 29, 14, 0, tzinfo=timezone.utc)
    runs = [
        ScanRun(id=uuid.uuid4(), account_id=aid, started_at=t0, finished_at=t0, status="ok"),
        ScanRun(id=uuid.uuid4(), account_id=aid, started_at=t1, finished_at=t1, status="ok"),
        ScanRun(id=uuid.uuid4(), account_id=aid, started_at=t2, finished_at=t2, status="ok"),
    ]
    db.scalars.return_value.all.side_effect = [[ctrl], ["chk"], [], runs]

    out = build_compliance_scan_timeline(db, aid, "soc2", days=30)
    assert len(out["events"]) == 1
    assert out["events"][0]["type"] == "baseline_established"
    assert "evidence_added" not in {e["type"] for e in out["events"]}


def test_scan_cadence_counts_control_flips_not_timeline_events():
    aid = uuid.uuid4()
    t = datetime(2026, 5, 29, 10, 0, tzinfo=timezone.utc)
    runs = [
        ScanRun(id=uuid.uuid4(), account_id=aid, started_at=t, finished_at=t, status="ok"),
    ]
    events = [
        {
            "type": "compliance_regressed",
            "timestamp": "2026-05-29T10:00:00+00:00",
            "diff": {
                "newly_failed": [{"control_id": "A.1"}],
                "newly_passed": [{"control_id": "A.2"}],
            },
        },
        {
            "type": "finding_resolved",
            "timestamp": "2026-05-29T11:00:00+00:00",
            "diff": {"newly_failed": [], "newly_passed": []},
        },
        {
            "type": "baseline_established",
            "timestamp": "2026-05-28T10:00:00+00:00",
            "diff": {"newly_failed": [{"control_id": "B.1"}], "newly_passed": []},
        },
    ]
    out = _scan_cadence(runs, events)
    assert out == [{"date": "2026-05-29", "scan_count": 1, "posture_change_count": 2}]


def test_period_summary_excludes_baseline_from_posture_changes():
    events = [
        {"type": "baseline_established", "diff": {"newly_failed": [{"control_id": "CC1"}], "newly_passed": []}},
        {
            "type": "compliance_regressed",
            "diff": {"newly_failed": [{"control_id": "CC2"}], "newly_passed": []},
        },
    ]
    summary = _period_summary(events)
    assert summary["evidence_snapshots"] == 2
    assert summary["compliance_changes"] == 1
    assert summary["controls_regressed"] == 1


def _finding(**kwargs):
    defaults = {
        "org_id": uuid.uuid4(),
        "account_id": uuid.uuid4(),
        "check_id": "iam.user.no_mfa",
        "resource_arn": "arn:aws:iam::123:user/a",
        "title": "MFA",
        "severity": "high",
        "status": "open",
        "first_seen": datetime(2026, 6, 1, tzinfo=timezone.utc),
    }
    defaults.update(kwargs)
    return Finding(**defaults)


def test_resolve_one_finding_does_not_pass_control_with_other_open_findings():
    ctrl = _ctrl()
    ctrl.control_id = "CC6.6"
    ctrl.title = "External Threat Controls"
    catalog = [(ctrl, ["iam.user.no_mfa", "iam.root.no_mfa"])]
    aid = uuid.uuid4()
    t0 = datetime(2026, 6, 1, tzinfo=timezone.utc)
    t_resolve = datetime(2026, 6, 10, tzinfo=timezone.utc)
    fid1 = uuid.uuid4()
    fid2 = uuid.uuid4()
    f1 = _finding(id=fid1, account_id=aid, check_id="iam.user.no_mfa", resource_arn="arn:a")
    f2 = _finding(id=fid2, account_id=aid, check_id="iam.root.no_mfa", resource_arn="arn:b")
    evt = FindingEvent(id=uuid.uuid4(), finding_id=fid1, action="resolved", ts=t_resolve)
    events_map = {fid1: [evt], fid2: []}
    runs = [ScanRun(id=uuid.uuid4(), account_id=aid, started_at=t0, finished_at=t0, status="ok")]

    failed, passed = _control_flip_for_finding_event(
        catalog=catalog,
        control_id="CC6.6",
        title=ctrl.title,
        findings=[f1, f2],
        events_by_finding=events_map,
        scan_runs=runs,
        evt=evt,
    )

    assert passed == []
    assert failed == []


def test_resolve_last_open_finding_passes_control():
    ctrl = _ctrl()
    ctrl.control_id = "CC6.6"
    catalog = [(ctrl, ["iam.user.no_mfa"])]
    aid = uuid.uuid4()
    t0 = datetime(2026, 6, 1, tzinfo=timezone.utc)
    t_resolve = datetime(2026, 6, 10, tzinfo=timezone.utc)
    fid = uuid.uuid4()
    finding = _finding(id=fid, account_id=aid)
    evt = FindingEvent(id=uuid.uuid4(), finding_id=fid, action="resolved", ts=t_resolve)
    events_map = {fid: [evt]}
    runs = [ScanRun(id=uuid.uuid4(), account_id=aid, started_at=t0, finished_at=t0, status="ok")]

    failed, passed = _control_flip_for_finding_event(
        catalog=catalog,
        control_id="CC6.6",
        title=ctrl.title,
        findings=[finding],
        events_by_finding=events_map,
        scan_runs=runs,
        evt=evt,
    )

    assert failed == []
    assert len(passed) == 1
    assert passed[0]["control_id"] == "CC6.6"
    assert passed[0]["open_finding_count"] == 0


def test_top_change_prefers_improved_control():
    out = _top_change(
        newly_failed=[],
        newly_passed=[{"control_id": "CC6.3", "title": "Access Removal", "open_finding_count": 0}],
        score_before=89,
        score_after=93,
    )
    assert out["direction"] == "improved"
    assert out["control_id"] == "CC6.3"


def test_scan_event_has_posture_and_diff_shape():
    db = MagicMock()
    out = build_compliance_scan_timeline(db, uuid.uuid4(), "soc2", days=30)
    # shape check only when events exist
    for evt in out["events"]:
        assert "posture_after" in evt or evt["type"] == "baseline_established"
        assert "snapshot" in evt
        assert "top_change" in evt
        if evt["type"] != "baseline_established":
            assert "diff" in evt
            assert "new_failures_count" in evt
        for ctrl in evt["diff"].get("newly_failed", []):
            assert "findings" not in ctrl
