"""Cloud scan progress publishing for GCP/Azure."""
from unittest.mock import MagicMock

from app.checks import gcp_compute_instance_public_ip, gcp_logging_not_enabled
from app.worker.cloud_scan import CloudScanProgressTracker, execute_cloud_scan


def test_cloud_tracker_publishes_collector_progress():
    run = MagicMock()
    run.stats = {}
    db = MagicMock()
    tracker = CloudScanProgressTracker(run, db, collector_count=2, check_count=2)

    tracker.start()
    tracker.publish_collector_start(1, 2, "collect_logging_audit")
    tracker.collector_done()

    assert run.stats.get("_progress_step") == 2
    assert run.stats.get("_progress_total") == 5
    assert run.stats.get("_progress_phase") == 1
    assert run.stats.get("_progress_collector_index") == 1
    assert run.stats.get("_progress_collector_total") == 2
    assert db.commit.called


def test_execute_cloud_scan_with_tracker_runs_collectors_and_checks():
    run = MagicMock()
    run.stats = {}
    db = MagicMock()
    target = MagicMock()

    def collector(_db, _target):
        return 1

    result = execute_cloud_scan(
        db,
        org_id="org",
        scope_column="gcp_project_id",
        scope_id="scope",
        collectors=[("collect_logging_audit", collector), ("collect_compute_instances", collector)],
        checks=[
            ("gcp_logging_not_enabled", gcp_logging_not_enabled.run),
            ("gcp_compute_instance_public_ip", gcp_compute_instance_public_ip.run),
        ],
        target=target,
        scan_run=run,
    )

    assert result.ok is True
    assert run.stats.get("_progress_step") == 5
    assert run.stats.get("checks_run_count") == 2
    assert "gcp.logging.not_enabled" in run.stats.get("checks_run", [])
    assert "gcp.compute.instance_public_ip" in run.stats.get("checks_run", [])
