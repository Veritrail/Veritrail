"""Cloud account overview metrics for GCP/Azure Accounts detail pane."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services.cloud_account_overview import (
    _gcp_region_from_zone,
    compute_cloud_compliance_posture,
    compute_cloud_evidence_coverage,
    count_cloud_resources,
)


def test_gcp_region_from_zone_strips_suffix():
    assert _gcp_region_from_zone("us-central1-a") == "us-central1"
    assert _gcp_region_from_zone("europe-west1-b") == "europe-west1"


def test_count_cloud_resources_gcp_includes_logging_and_compute():
    project_id = uuid.uuid4()
    db = MagicMock()
    db.scalars.return_value.all.return_value = [
        SimpleNamespace(zone="us-central1-a"),
        SimpleNamespace(zone="us-central1-b"),
        SimpleNamespace(zone="europe-west1-a"),
    ]
    db.scalar.return_value = SimpleNamespace()

    resources, regions = count_cloud_resources(db, "gcp", project_id)
    assert resources == 4
    assert regions == 2


def test_compute_cloud_evidence_coverage_counts_scan_days():
    resource_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    run = SimpleNamespace(
        finished_at=now,
        started_at=now - timedelta(hours=1),
    )
    db = MagicMock()
    db.scalar.side_effect = [now - timedelta(days=3), 1, None]
    db.scalars.return_value.all.return_value = [run]

    payload = compute_cloud_evidence_coverage(
        db,
        "gcp",
        resource_id,
        since=now - timedelta(days=7),
        end=now,
        period_days=7,
    )
    assert payload["days_with_data"] == 1
    assert payload["coverage_ratio"] == round(1 / 7, 4)
    assert payload["snapshot_days_in_period"] == 0


def test_compute_cloud_compliance_posture_ignores_no_data_controls(monkeypatch):
    org_id = uuid.uuid4()
    resource_id = uuid.uuid4()
    ctrl = SimpleNamespace(id=uuid.uuid4(), control_id="CC1.1", title="")
    catalog = [(ctrl, ["gcp.test.check"])]
    db = MagicMock()
    db.get.return_value = SimpleNamespace(settings={})

    monkeypatch.setattr(
        "app.services.cloud_account_overview._cloud_scan_context",
        lambda *args, **kwargs: ({}, {}, set(), True),
    )
    monkeypatch.setattr(
        "app.services.cloud_account_overview._soc2_controls_for_provider",
        lambda *args, **kwargs: catalog,
    )
    monkeypatch.setattr(
        "app.services.cloud_account_overview.compute_control_status",
        lambda *args, **kwargs: ("pass", None, None),
    )

    assert compute_cloud_compliance_posture(db, org_id, "gcp", resource_id) == 100

    monkeypatch.setattr(
        "app.services.cloud_account_overview.compute_control_status",
        lambda *args, **kwargs: ("no_data", None, None),
    )
    assert compute_cloud_compliance_posture(db, org_id, "gcp", resource_id) is None
