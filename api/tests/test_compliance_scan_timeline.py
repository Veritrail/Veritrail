from datetime import datetime, timezone
from unittest.mock import MagicMock
import uuid

from app.models import ScanRun
from app.models.control import Control
from app.services.compliance_scan_timeline import (
    _period_summary,
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
