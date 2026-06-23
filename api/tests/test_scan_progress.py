"""Scan progress advances per collector + per check (so the UI bar/stepper moves).

Regression: collectors and checks ran without advancing the progress tracker, so
`_progress_step` was never published and the UI sat on "Initializing" for the
whole scan.
"""
from unittest.mock import MagicMock

from app.worker.scan_pipeline import ScanPipeline, ScanProgressTracker


def test_tracker_bump_advances_and_publishes():
    run = MagicMock()
    run.stats = {}
    db = MagicMock()
    tracker = ScanProgressTracker(run, enabled_checks=[1, 2, 3], db=db)

    for _ in range(8):
        tracker.bump(1)

    assert tracker._step_counter == 8
    # Publishes every 4 steps → step 8 is written to run.stats and committed.
    assert run.stats.get("_progress_step") == 8
    assert run.stats.get("_progress_total") == tracker._total
    assert db.commit.called


def test_collect_bumps_tracker_per_collector():
    db = MagicMock()
    run = MagicMock()
    run.stats = {}
    pipe = ScanPipeline(db, MagicMock(), run)
    tracker = ScanProgressTracker(run, enabled_checks=[], db=db)

    collectors = [
        ("a", lambda d, a: {}),
        ("b", lambda d, a: 0),
        ("c", lambda d, a: {"x": 1}),
    ]
    pipe._collect(collectors, tracker)

    assert tracker._step_counter == 3  # one step per collector


def test_collect_bumps_even_when_a_collector_fails():
    db = MagicMock()
    run = MagicMock()
    run.stats = {}
    pipe = ScanPipeline(db, MagicMock(), run)
    tracker = ScanProgressTracker(run, enabled_checks=[], db=db)

    def boom(d, a):
        raise RuntimeError("collector down")

    pipe._collect([("ok", lambda d, a: {}), ("bad", boom)], tracker)

    assert tracker._step_counter == 2  # failed collector still advances the bar


def test_run_checks_bumps_per_check():
    db = MagicMock()
    acc = MagicMock()
    run = MagicMock()
    run.stats = {}
    pipe = ScanPipeline(db, acc, run)

    chk1 = MagicMock(); chk1.CHECK_ID = "x.one"; chk1.run.return_value = []
    chk2 = MagicMock(); chk2.CHECK_ID = "x.two"; chk2.run.return_value = []
    tracker = ScanProgressTracker(run, enabled_checks=[chk1, chk2], db=db)

    pipe._run_checks([chk1, chk2], tracker)

    assert tracker._step_counter == 2
