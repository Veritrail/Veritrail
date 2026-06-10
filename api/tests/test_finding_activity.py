"""Tests for finding activity timeline builder."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from app.services.finding_activity import build_finding_activity


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s)


def _finding(*, first_seen: str, last_seen: str | None = None, resolved_at: str | None = None, status: str = "open"):
    f = MagicMock()
    f.id = uuid.uuid4()
    f.account_id = uuid.uuid4()
    f.first_seen = _ts(first_seen)
    f.last_seen = _ts(last_seen or first_seen)
    f.resolved_at = _ts(resolved_at) if resolved_at else None
    f.status = status
    return f


def _event(action: str, ts: str, note: str | None = None):
    e = MagicMock()
    e.ts = _ts(ts)
    e.action = action
    e.note = note
    return e


def _scan(finished_at: str):
    run = MagicMock()
    run.id = uuid.uuid4()
    run.finished_at = _ts(finished_at)
    run.status = "ok"
    return run


@pytest.fixture
def patch_events(monkeypatch):
    def _patch(finding, events: list):
        monkeypatch.setattr(
            "app.services.finding_activity.load_events_by_finding",
            lambda _db, _ids: {finding.id: events},
        )

    return _patch


def test_includes_opened_event_marker(patch_events):
    f = _finding(first_seen="2026-05-01T00:00:00+00:00")
    events = [_event("opened", "2026-05-01T00:00:00+00:00")]
    patch_events(f, events)
    db = MagicMock()
    db.scalars.return_value.all.return_value = []
    out = build_finding_activity(db, f, days=90)
    kinds = [m["kind"] for m in out["markers"]]
    assert kinds == ["opened"]


def test_synthesizes_opened_from_first_seen_when_no_event(patch_events):
    f = _finding(first_seen="2026-05-01T00:00:00+00:00")
    patch_events(f, [])
    db = MagicMock()
    db.scalars.return_value.all.return_value = []
    out = build_finding_activity(db, f, days=90)
    assert out["markers"][0]["kind"] == "opened"
    assert out["markers"][0]["ts"] == f.first_seen


def test_scan_markers_only_when_open_at_scan_time(patch_events):
    f = _finding(
        first_seen="2026-05-01T00:00:00+00:00",
        resolved_at="2026-05-10T00:00:00+00:00",
        status="resolved",
    )
    events = [
        _event("opened", "2026-05-01T00:00:00+00:00"),
        _event("resolved", "2026-05-10T00:00:00+00:00"),
    ]
    scans = [
        _scan("2026-05-05T00:00:00+00:00"),
        _scan("2026-05-15T00:00:00+00:00"),
    ]
    patch_events(f, events)
    db = MagicMock()
    db.scalars.return_value.all.return_value = scans
    out = build_finding_activity(db, f, days=90)
    scan_kinds = [m["kind"] for m in out["markers"] if m["kind"] == "scan_open"]
    assert len(scan_kinds) == 1


def test_dedupes_scan_markers_same_day(patch_events):
    f = _finding(first_seen="2026-05-01T00:00:00+00:00")
    events = [_event("opened", "2026-05-01T00:00:00+00:00")]
    scans = [
        _scan("2026-05-05T08:00:00+00:00"),
        _scan("2026-05-05T20:00:00+00:00"),
    ]
    patch_events(f, events)
    db = MagicMock()
    db.scalars.return_value.all.return_value = scans
    out = build_finding_activity(db, f, days=90)
    scan_markers = [m for m in out["markers"] if m["kind"] == "scan_open"]
    assert len(scan_markers) == 1


def test_open_days_uses_resolved_at_when_resolved(patch_events):
    f = _finding(
        first_seen="2026-05-01T00:00:00+00:00",
        resolved_at="2026-05-11T00:00:00+00:00",
        status="resolved",
    )
    patch_events(f, [])
    db = MagicMock()
    db.scalars.return_value.all.return_value = []
    out = build_finding_activity(db, f, days=90)
    assert out["open_days"] == 10
