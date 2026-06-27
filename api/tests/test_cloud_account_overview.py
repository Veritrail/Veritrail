"""Cloud account overview metrics for GCP/Azure Accounts detail pane."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services.cloud_account_overview import (
    _gcp_region_from_zone,
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
