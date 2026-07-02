"""Cloud scan progress publishing for GCP/Azure."""
from unittest.mock import MagicMock

from app.checks import gcp_compute_instance_public_ip, gcp_logging_not_enabled
from app.worker.cloud_scan import CloudScanProgressTracker, execute_cloud_scan, is_connection_failure_message


def test_is_connection_failure_message_detects_gcp_auth_errors():
    assert is_connection_failure_message("ValueError: GCP credentials unauthorized")
    assert is_connection_failure_message("ValueError: GCP credentials lack required permissions")
    assert not is_connection_failure_message("ValueError: GCP API error 500: internal")


def test_execute_cloud_scan_fails_on_collector_connection_error():
    run = MagicMock()
    run.stats = {}
    db = MagicMock()
    target = MagicMock()
    on_error = MagicMock()

    def failing_collector(_db, _target):
        raise ValueError("GCP credentials unauthorized")

    result = execute_cloud_scan(
        db,
        org_id="org",
        scope_column="gcp_project_id",
        scope_id="scope",
        collectors=[("collect_logging_audit", failing_collector)],
        checks=[],
        target=target,
        scan_run=run,
        on_error=on_error,
    )

    assert result.ok is False
    assert "unauthorized" in (result.error or "").lower()
    on_error.assert_called_once()


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
