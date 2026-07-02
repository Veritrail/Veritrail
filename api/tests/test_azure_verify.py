"""Azure subscription verify route tests."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

from app.models.azure_subscription import AzureSubscription
from app.routes.azure_integration import verify_azure_subscription


def test_verify_azure_subscription_connected_when_optional_apis_lack_permission():
    """Core verify must succeed even when scan APIs only report degraded checks."""
    org_id = uuid.uuid4()
    subscription_row_id = uuid.uuid4()
    row = AzureSubscription(
        id=subscription_row_id,
        org_id=org_id,
        subscription_id="sub-1",
        tenant_id="tenant-1",
        client_id="client-1",
        client_secret="secret",
        status="pending",
    )
    db = MagicMock()
    db.get.return_value = row

    degraded = [
        {
            "check_id": "azure.logging.not_enabled",
            "api": "activity_log",
            "reason": "Azure credentials lack required permissions",
        }
    ]

    org = MagicMock()
    org.id = org_id

    with (
        patch("app.routes.azure_integration._get_org", return_value=org),
        patch("app.routes.azure_integration.AzureClient") as client_cls,
        patch("app.services.azure_permission_probes.probe_azure_scan_permissions", return_value=degraded) as probe,
    ):
        client = client_cls.return_value
        client.verify.return_value = {
            "subscription_id": "sub-1",
            "display_name": "Production",
            "state": "Enabled",
        }

        result = verify_azure_subscription(
            subscription_row_id,
            _rbac=MagicMock(),
            p={"org_id": str(org_id)},
            db=db,
        )

    assert result["ok"] is True
    assert result["degraded_checks"] == degraded
    assert row.status == "connected"
    assert row.last_error is None
    probe.assert_called_once_with(row)
    db.commit.assert_called()
