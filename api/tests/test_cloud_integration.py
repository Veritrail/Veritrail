"""Cloud normalization API helpers."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.models import AwsAccount, Finding
from app.models.azure_subscription import AzureSubscription
from app.models.gcp_project import GcpProject
from app.models.org import Org, User
from app.routes.findings import _to_out, findings_summary
from app.services.cloud_normalization import (
    build_cloud_coverage,
    cloud_open_findings_total,
    list_cloud_accounts,
    open_findings_count,
)
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
                last_error="AccessDenied",
            )
        ])),
        MagicMock(all=MagicMock(return_value=[
            SimpleNamespace(
                id=gcp_id,
                project_id="demo-project",
                label="Demo",
                status="connected",
                last_scan_at=now,
                last_error=None,
            )
        ])),
        MagicMock(all=MagicMock(return_value=[
            SimpleNamespace(
                id=azure_id,
                subscription_id="sub-abc",
                label="Azure Prod",
                status="pending",
                last_scan_at=None,
                last_error=None,
            )
        ])),
    ]
    db.scalar.side_effect = [2, 1, 0]

    rows = list_cloud_accounts(db, org_id)
    assert len(rows) == 3
    assert rows[0]["provider"] == "aws"
    assert rows[0]["external_id"] == "123456789012"
    assert rows[0]["open_findings_count"] == 2
    assert rows[0]["last_error"] == "AccessDenied"
    assert rows[1]["provider"] == "gcp"
    assert rows[1]["label"] == "Demo"
    assert rows[1]["open_findings_count"] == 1
    assert rows[2]["provider"] == "azure"
    assert rows[2]["status"] == "pending"
    assert rows[2]["open_findings_count"] == 0


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


def _seed_org_user(db):
    org = Org(name="Cloud Norm Co")
    db.add(org)
    db.flush()
    user = User(org_id=org.id, email=f"u{uuid.uuid4().hex[:8]}@example.com", password_hash="x", role="admin")
    db.add(user)
    db.flush()
    return org, user


def _finding(org_id, **kwargs):
    now = datetime.now(timezone.utc)
    defaults = dict(
        org_id=org_id,
        check_id="iam.user.no_mfa",
        resource_arn="arn:aws:iam::123456789012:user/alice",
        title="No MFA",
        severity="high",
        risk_score=70,
        status="open",
        evidence={},
        first_seen=now,
        last_seen=now,
    )
    defaults.update(kwargs)
    return Finding(**defaults)


def test_cloud_coverage_matches_findings_summary(db_session):
    org, user = _seed_org_user(db_session)
    aws = AwsAccount(
        org_id=org.id,
        label="Prod AWS",
        account_id="123456789012",
        external_id="ext-aws",
        status="connected",
        last_scan_at=datetime.now(timezone.utc),
    )
    gcp = GcpProject(org_id=org.id, project_id="demo-gcp", label="Demo GCP", status="connected")
    azure = AzureSubscription(
        org_id=org.id,
        subscription_id="sub-demo",
        tenant_id="tenant-1",
        client_id="client-1",
        client_secret="secret",
        label="Demo Azure",
        status="connected",
    )
    db_session.add_all([aws, gcp, azure])
    db_session.flush()

    db_session.add(_finding(org.id, account_id=aws.id, severity="high"))
    db_session.add(_finding(org.id, account_id=aws.id, severity="medium", check_id="s3.bucket.public_read"))
    db_session.add(
        _finding(
            org.id,
            account_id=None,
            gcp_project_id=gcp.id,
            check_id="gcp.logging.not_enabled",
            resource_arn="gcp://logging/demo-gcp",
            severity="critical",
        )
    )
    db_session.add(
        _finding(
            org.id,
            account_id=None,
            azure_subscription_id=azure.id,
            check_id="azure.defender.not_enabled",
            resource_arn="azure://defender/sub-demo",
            severity="high",
        )
    )
    db_session.flush()

    coverage = build_cloud_coverage(db_session, org.id)
    summary = findings_summary(p={"org_id": str(org.id), "sub": str(user.id)}, db=db_session)

    assert coverage["total_open_findings"] == summary.by_status.get("open", 0)
    assert coverage["total_open_findings"] == cloud_open_findings_total(db_session, org.id)
    assert open_findings_count(db_session, org_id=org.id, provider="aws") == 2
    assert open_findings_count(db_session, org_id=org.id, provider="gcp") == 1
    assert open_findings_count(db_session, org_id=org.id, provider="azure") == 1

    rows = list_cloud_accounts(db_session, org.id)
    by_provider = {row["provider"]: row for row in rows}
    assert by_provider["aws"]["open_findings_count"] == 2
    assert by_provider["gcp"]["open_findings_count"] == 1
    assert by_provider["azure"]["open_findings_count"] == 1
    assert sum(row["open_findings_count"] for row in rows) == coverage["total_open_findings"]
