"""Cloud account overview metrics for GCP/Azure detail panes."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services.cloud_account_overview import (
    compute_cloud_evidence_coverage,
    count_cloud_resources,
)


def test_count_gcp_resources_includes_compute_and_logging():
    project_id = uuid.uuid4()
    db = MagicMock()
    db.scalars.side_effect = [
        MagicMock(all=MagicMock(return_value=[
            SimpleNamespace(zone="us-central1-a"),
            SimpleNamespace(zone="europe-west1-b"),
        ])),
    ]
    db.scalar.return_value = SimpleNamespace()

    resources, regions = count_cloud_resources(db, "gcp", project_id)
    assert resources == 3
    assert regions == 2


def test_compute_cloud_evidence_coverage_counts_scan_days():
    resource_id = uuid.uuid4()
    since = datetime(2026, 6, 1, tzinfo=timezone.utc)
    end = datetime(2026, 6, 7, 23, 59, 59, tzinfo=timezone.utc)

    ok_runs = [
        SimpleNamespace(
            finished_at=datetime(2026, 6, 3, 12, tzinfo=timezone.utc),
            started_at=datetime(2026, 6, 3, 11, tzinfo=timezone.utc),
        ),
        SimpleNamespace(
            finished_at=datetime(2026, 6, 5, 12, tzinfo=timezone.utc),
            started_at=datetime(2026, 6, 5, 11, tzinfo=timezone.utc),
        ),
    ]

    db = MagicMock()
    db.scalar.side_effect = [ok_runs[0].started_at, 2, None]
    db.scalars.return_value.all.return_value = ok_runs

    payload = compute_cloud_evidence_coverage(db, "gcp", resource_id, since, end, 7)
    assert payload["days_with_data"] == 2
    assert payload["coverage_ratio"] == round(2 / 7, 4)
    assert payload["successful_scans_in_period"] == 2
