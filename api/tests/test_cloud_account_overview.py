"""Cloud account overview metrics for GCP/Azure Accounts detail pane."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.models.gcp_project import GcpProject
from app.models.org import Org
from app.services.cloud_account_overview import (
    _gcp_region_from_zone,
    build_cloud_account_overview,
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
    db.scalars.return_value.all.side_effect = [
        [
            SimpleNamespace(zone="us-central1-a"),
            SimpleNamespace(zone="us-central1-b"),
            SimpleNamespace(zone="europe-west1-a"),
        ],
        [],
    ]
    db.scalar.side_effect = [SimpleNamespace(), SimpleNamespace(), SimpleNamespace()]

    resources, regions = count_cloud_resources(db, "gcp", project_id)
    assert resources == 6
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


def test_compute_cloud_compliance_posture_counts_no_data_in_denominator(monkeypatch):
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
    assert compute_cloud_compliance_posture(db, org_id, "gcp", resource_id) == 0


def test_build_cloud_account_overview_gcp_queries_release3_tables(db_session):
    """Regression: overview must not 500 when Release 3 collector tables exist (migration 0080)."""
    org = Org(name="Cloud Overview Co")
    db_session.add(org)
    db_session.flush()
    project = GcpProject(
        org_id=org.id,
        project_id="overview-demo",
        label="Overview Demo",
        status="connected",
        last_scan_at=datetime.now(timezone.utc),
    )
    db_session.add(project)
    db_session.flush()

    payload = build_cloud_account_overview(
        db_session,
        org.id,
        "gcp",
        project.id,
        period=7,
        as_of="2026-06-25",
    )

    assert payload["provider"] == "gcp"
    assert payload["resource_id"] == str(project.id)
    assert payload["resources_covered"] == 0
    assert payload["coverage"]["period_days"] == 7
    assert isinstance(payload["posture_trend"], list)
    assert isinstance(payload["open_findings_trend"], list)
