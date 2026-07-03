"""Evidence period coverage — scan/snapshot days in audit window."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock
import uuid

from app.services.evidence_coverage import (
    _dates_in_period,
    compute_evidence_coverage,
    period_bounds,
)


def test_period_bounds_spans_exactly_period_days():
    end = datetime(2026, 7, 3, 15, 30, tzinfo=timezone.utc)
    since, period_end = period_bounds(end, 7)
    assert len(_dates_in_period(since, period_end)) == 7
    assert since.date().isoformat() == "2026-06-27"
    assert period_end.date().isoformat() == "2026-07-03"


def test_old_since_end_window_is_one_day_too_long():
    """Regression: end - timedelta(days=period) counted period+1 calendar days."""
    end = datetime(2026, 7, 3, 15, 30, tzinfo=timezone.utc)
    since = end - timedelta(days=7)
    assert len(_dates_in_period(since, end)) == 8


def test_compute_evidence_coverage_ratio_capped_when_window_has_full_data():
    account_id = uuid.uuid4()
    end = datetime(2026, 7, 3, 12, 0, tzinfo=timezone.utc)
    since, period_end = period_bounds(end, 7)
    runs = [
        SimpleNamespace(
            finished_at=datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc),
            started_at=datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc),
        )
        for day in _dates_in_period(since, period_end)
    ]

    db = MagicMock()
    db.scalar.side_effect = [since, len(runs), None]
    db.scalars.return_value.all.side_effect = [runs, []]

    payload = compute_evidence_coverage(db, account_id, since, period_end, 7)
    assert payload["days_with_data"] == 7
    assert payload["coverage_ratio"] == 1.0


def test_compute_evidence_coverage_legacy_bounds_cannot_exceed_one():
    """Even with legacy callers passing an 8-day window for period=7, ratio stays <= 1."""
    account_id = uuid.uuid4()
    end = datetime(2026, 7, 3, 12, 0, tzinfo=timezone.utc)
    since = end - timedelta(days=7)
    runs = [
        SimpleNamespace(
            finished_at=datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc),
            started_at=datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc),
        )
        for day in _dates_in_period(since, end)
    ]

    db = MagicMock()
    db.scalar.side_effect = [since, len(runs), None]
    db.scalars.return_value.all.side_effect = [runs, []]

    payload = compute_evidence_coverage(db, account_id, since, end, 7)
    assert payload["days_with_data"] == 8
    assert payload["coverage_ratio"] == 1.0
