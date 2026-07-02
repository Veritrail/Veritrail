"""Azure verify permission probe tests."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

from app.models.azure_subscription import AzureSubscription
from app.services.azure_permission_probes import probe_azure_scan_permissions


def test_probe_azure_scan_permissions_reports_degraded_checks():
    subscription = AzureSubscription(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        subscription_id="sub-1",
        tenant_id="tenant-1",
        client_id="client-1",
        client_secret="secret",
        status="pending",
    )

    with patch("app.services.azure_permission_probes.AzureClient") as client_cls:
        client = client_cls.return_value
        client.list_secure_scores_soft.return_value = ([], 200)
        client.list_storage_accounts_soft.return_value = ([], 200)
        client.query_resource_graph.return_value = ([], 200)
        client.list_subscription_diagnostic_settings.return_value = ([], 200)
        client.list_role_assignments.return_value = ([], 403)

        degraded = probe_azure_scan_permissions(subscription)

    assert any(row["check_id"] == "azure.entra.privileged_role_assignment" for row in degraded)
    assert all(row["api"] for row in degraded)
