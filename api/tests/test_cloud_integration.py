"""Cloud normalization API helpers."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.routes.findings import _to_out
from app.services.cloud_normalization import build_cloud_coverage, list_cloud_accounts
from app.services.cloud_scan_runs import list_cloud_scans


def test_list_cloud_scans_returns_newest_first():
    resource_id = uuid.uuid4()
    older = SimpleNamespace(
        id=uuid.uuid4(),
        started_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    newer = SimpleNamespace(
        id=uuid.uuid4(),
        started_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
    )
    db = MagicMock()
    db.scalars.return_value.all.return_value = [newer, older]

    runs = list_cloud_scans(db, provider="gcp", resource_id=resource_id, limit=3)
    assert runs == [newer, older]
    db.scalars.assert_called_once()


def test_list_cloud_accounts_normalizes_all_providers():
    org_id = uuid.uuid4()
    aws_id = uuid.uuid4()
    gcp_id = uuid.uuid4()
    azure_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    db = MagicMock()
    db.scalars.side_effect = [
        MagicMock(all=MagicMock(return_value=[
            SimpleNamespace(
                id=aws_id,
                account_id="123456789012",
                label="Prod",
                status="connected",
                last_scan_at=now,
            )
        ])),
        MagicMock(all=MagicMock(return_value=[
            SimpleNamespace(
                id=gcp_id,
                project_id="demo-project",
                label="Demo",
                status="connected",
                last_scan_at=now,
            )
        ])),
        MagicMock(all=MagicMock(return_value=[
            SimpleNamespace(
                id=azure_id,
                subscription_id="sub-abc",
                label="Azure Prod",
                status="pending",
                last_scan_at=None,
            )
        ])),
    ]

    rows = list_cloud_accounts(db, org_id)
    assert len(rows) == 3
    assert rows[0]["provider"] == "aws"
    assert rows[0]["external_id"] == "123456789012"
    assert rows[1]["provider"] == "gcp"
    assert rows[1]["label"] == "Demo"
    assert rows[2]["provider"] == "azure"
    assert rows[2]["status"] == "pending"


def test_build_cloud_coverage_aggregates_providers():
    org_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    db = MagicMock()

    db.scalars.side_effect = [
        MagicMock(all=MagicMock(return_value=[SimpleNamespace(last_scan_at=now)])),
        MagicMock(all=MagicMock(return_value=[SimpleNamespace(last_scan_at=now)])),
        MagicMock(all=MagicMock(return_value=[])),
    ]
    db.scalar.side_effect = [5, 2, 0]

    payload = build_cloud_coverage(db, org_id)
    assert payload["total_connected"] == 2
    assert payload["total_open_findings"] == 7
    assert payload["providers"][0]["provider"] == "aws"
    assert payload["providers"][0]["connected_count"] == 1
    assert payload["providers"][0]["open_findings_count"] == 5
    assert payload["providers"][2]["connected_count"] == 0


def test_to_out_gcp_includes_provider_and_scope():
    project_id = uuid.uuid4()
    f = SimpleNamespace(
        id=uuid.uuid4(),
        account_id=None,
        gcp_project_id=project_id,
        azure_subscription_id=None,
        check_id="gcp.logging.not_enabled",
        resource_arn="gcp://logging/demo-project",
        title="Audit logging not enabled",
        severity="high",
        risk_score=80,
        status="open",
        evidence={"project_id": "demo-project"},
        first_seen=datetime.now(timezone.utc),
        last_seen=datetime.now(timezone.utc),
        exception_reason=None,
        exception_approved_by=None,
        exception_expires_at=None,
        remediation_ticket_key=None,
        remediation_ticket_url=None,
    )
    proj = SimpleNamespace(label="Demo", project_id="demo-project")
    out = _to_out(f, {}, {project_id: proj}, {})
    assert out.account_provider == "gcp"
    assert out.account_label == "Demo"
    assert out.account_name == "Demo"
