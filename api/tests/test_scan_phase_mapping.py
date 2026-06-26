"""UI phase mapping stays aligned with weighted progress ratio."""
from unittest.mock import MagicMock

from app.worker.scan_pipeline import ScanPipeline, ScanProgressTracker, _COLLECTOR_STEPS


def _tracker(nchecks: int = 40) -> ScanProgressTracker:
    run = MagicMock()
    run.stats = {}
    db = MagicMock()
    checks = [object() for _ in range(nchecks)]
    tracker = ScanProgressTracker(run, checks, db)
    tracker.set_enabled_checks(checks)
    return tracker


def test_phase_initializing_only_during_bootstrap():
    tracker = _tracker()
    assert tracker._phase(0) == 0
    assert tracker._phase(1) == 0


def test_phase_collecting_during_mid_collection():
    tracker = _tracker()
    # ~31% weighted progress: step 18 of 32 collectors
    assert tracker._phase(18) == 1


def test_phase_advances_to_analyzing_after_collection():
    tracker = _tracker()
    assert tracker._phase(_COLLECTOR_STEPS + 1) >= 2


def test_publish_includes_step_name():
    tracker = _tracker()
    tracker.publish_collector_start(3, 32, "collect_iam")
    assert tracker.run.stats.get("_progress_step_name") == "collect_iam"
    assert tracker.run.stats.get("_progress_collector_index") == 3
    assert tracker.run.stats.get("_progress_collector_total") == 32


def test_collect_publishes_at_collector_start():
    db = MagicMock()
    run = MagicMock()
    run.stats = {}
    pipe = ScanPipeline(db, MagicMock(), run)
    tracker = ScanProgressTracker(run, enabled_checks=[], db=db)

    def slow(_db, _acc):
        # Simulate mid-collector read: stats should already show this collector.
        assert run.stats.get("_progress_collector_index") == 2
        assert run.stats.get("_progress_step_name") == "b"
        return {}

    collectors = [
        ("a", lambda d, a: {}),
        ("b", slow),
    ]
    pipe._collect(collectors, tracker)

    assert tracker._step_counter == 2


def test_ratio_matches_collection_weighting():
    tracker = _tracker()
    ratio = tracker._ratio(18)
    assert 0.29 < ratio < 0.33
