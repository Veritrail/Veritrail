"""Azure client and collector tests with mocked HTTP."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

from app.collectors.azure.defender import collect_defender
from app.collectors.azure.resource_graph import collect_resource_graph
from app.collectors.azure.storage import collect_storage_accounts
from app.collectors.azure.activity_log import collect_activity_log
from app.collectors.azure.entra_rbac import collect_entra_rbac
from app.collectors.azure.policy_compliance import collect_policy_compliance
from app.services.azure_client import AzureClient, privileged_role_name


def _resp(status_code: int = 200, payload: dict | None = None) -> MagicMock:
    r = MagicMock()
    r.status_code = status_code
    r.content = b"{}"
    r.text = ""
    r.json.return_value = payload or {}
    return r


def test_azure_client_verify_subscription():
    with patch.object(AzureClient, "_access_token", return_value="tok"):
        with patch("app.services.azure_client.httpx.Client") as client_cls:
            client = MagicMock()
            client.__enter__.return_value = client
            client.__exit__.return_value = False
            client.request.return_value = _resp(
                payload={"subscriptionId": "sub-1", "displayName": "Prod", "state": "Enabled"}
            )
            client_cls.return_value = client
            out = AzureClient(tenant_id="t1", client_id="c1", client_secret="s1").verify("sub-1")
    assert out["subscription_id"] == "sub-1"


def test_collect_defender_enabled(mock_db):
    sub = MagicMock()
    sub.id = uuid.uuid4()
    sub.subscription_id = "sub-1"
    sub.tenant_id = "t1"
    sub.client_id = "c1"
    sub.client_secret = "s1"

    with patch("app.collectors.azure.defender.AzureClient") as client_cls:
        client = client_cls.return_value
        client.list_secure_scores.return_value = [{"properties": {"score": {"current": 72.5}}}]
        client.get_security_pricing.return_value = [{"properties": {"pricingTier": "Standard"}}]
        count = collect_defender(mock_db, sub)
    assert count == 1
    mock_db.execute.assert_called()


def test_collect_storage_public_blob(mock_db):
    sub = MagicMock()
    sub.id = uuid.uuid4()
    sub.subscription_id = "sub-1"
    sub.tenant_id = "t1"
    sub.client_id = "c1"
    sub.client_secret = "s1"

    with patch("app.collectors.azure.storage.AzureClient") as client_cls:
        client_cls.return_value.list_storage_accounts.return_value = [
            {
                "name": "publicstore",
                "id": "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Storage/storageAccounts/publicstore",
                "properties": {"allowBlobPublicAccess": True},
            }
        ]
        count = collect_storage_accounts(mock_db, sub)
    assert count == 1
    mock_db.execute.assert_called()


def test_azure_client_query_resource_graph_pagination():
    with patch.object(AzureClient, "_access_token", return_value="tok"):
        with patch("app.services.azure_client.httpx.Client") as client_cls:
            client = MagicMock()
            client.__enter__.return_value = client
            client.__exit__.return_value = False
            client.request.side_effect = [
                _resp(payload={"data": [{"vmId": "vm-1", "name": "web-1"}], "$skipToken": "next"}),
                _resp(payload={"data": [{"vmId": "vm-2", "name": "web-2"}]}),
            ]
            client_cls.return_value = client
            rows, status = AzureClient(
                tenant_id="t1", client_id="c1", client_secret="s1"
            ).query_resource_graph("sub-1", "Resources | project id")
    assert status == 200
    assert len(rows) == 2


def test_azure_client_query_resource_graph_soft_fail():
    with patch.object(AzureClient, "_access_token", return_value="tok"):
        with patch("app.services.azure_client.httpx.Client") as client_cls:
            client = MagicMock()
            client.__enter__.return_value = client
            client.__exit__.return_value = False
            client.request.return_value = _resp(status_code=403)
            client_cls.return_value = client
            rows, status = AzureClient(
                tenant_id="t1", client_id="c1", client_secret="s1"
            ).query_resource_graph("sub-1", "Resources | project id")
    assert status == 403
    assert rows == []


def test_collect_resource_graph_flags_public_ip(mock_db):
    sub = MagicMock()
    sub.id = uuid.uuid4()
    sub.subscription_id = "sub-1"
    sub.tenant_id = "t1"
    sub.client_id = "c1"
    sub.client_secret = "s1"

    with patch("app.collectors.azure.resource_graph.AzureClient") as client_cls:
        client_cls.return_value.query_resource_graph.return_value = (
            [
                {
                    "vmId": "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachines/public-vm",
                    "name": "public-vm",
                    "resourceGroup": "rg1",
                    "location": "eastus",
                    "has_public_ip": True,
                },
                {
                    "vmId": "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachines/private-vm",
                    "name": "private-vm",
                    "resourceGroup": "rg1",
                    "location": "eastus",
                    "has_public_ip": False,
                },
            ],
            200,
        )
        count = collect_resource_graph(mock_db, sub)
    assert count == 2
    assert mock_db.execute.call_count == 2


def test_collect_resource_graph_skips_on_forbidden(mock_db):
    sub = MagicMock()
    sub.id = uuid.uuid4()
    sub.subscription_id = "sub-1"
    sub.tenant_id = "t1"
    sub.client_id = "c1"
    sub.client_secret = "s1"

    with patch("app.collectors.azure.resource_graph.AzureClient") as client_cls:
        client_cls.return_value.query_resource_graph.return_value = ([], 403)
        count = collect_resource_graph(mock_db, sub)
    assert count == 0
    mock_db.execute.assert_not_called()


def test_azure_client_list_subscription_diagnostic_settings():
    with patch.object(AzureClient, "_access_token", return_value="tok"):
        with patch("app.services.azure_client.httpx.Client") as client_cls:
            client = MagicMock()
            client.__enter__.return_value = client
            client.__exit__.return_value = False
            client.request.return_value = _resp(
                payload={
                    "value": [
                        {
                            "name": "export-to-law",
                            "properties": {
                                "logs": [{"category": "Administrative", "enabled": True}],
                                "workspaceId": "/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.OperationalInsights/workspaces/law",
                            },
                        }
                    ]
                }
            )
            client_cls.return_value = client
            settings, status = AzureClient(
                tenant_id="t1", client_id="c1", client_secret="s1"
            ).list_subscription_diagnostic_settings("sub-1")
    assert status == 200
    assert len(settings) == 1


def test_azure_client_list_subscription_diagnostic_settings_soft_fail():
    with patch.object(AzureClient, "_access_token", return_value="tok"):
        with patch("app.services.azure_client.httpx.Client") as client_cls:
            client = MagicMock()
            client.__enter__.return_value = client
            client.__exit__.return_value = False
            client.request.return_value = _resp(status_code=403)
            client_cls.return_value = client
            settings, status = AzureClient(
                tenant_id="t1", client_id="c1", client_secret="s1"
            ).list_subscription_diagnostic_settings("sub-1")
    assert status == 403
    assert settings == []


def test_collect_activity_log_export_enabled(mock_db):
    sub = MagicMock()
    sub.id = uuid.uuid4()
    sub.subscription_id = "sub-1"
    sub.tenant_id = "t1"
    sub.client_id = "c1"
    sub.client_secret = "s1"

    with patch("app.collectors.azure.activity_log.AzureClient") as client_cls:
        client_cls.return_value.list_subscription_diagnostic_settings.return_value = (
            [
                {
                    "name": "export-to-law",
                    "properties": {
                        "logs": [{"category": "Administrative", "enabled": True}],
                        "workspaceId": "/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.OperationalInsights/workspaces/law",
                    },
                }
            ],
            200,
        )
        count = collect_activity_log(mock_db, sub)
    assert count == 1
    mock_db.execute.assert_called()


def test_collect_activity_log_skips_on_forbidden(mock_db):
    sub = MagicMock()
    sub.id = uuid.uuid4()
    sub.subscription_id = "sub-1"
    sub.tenant_id = "t1"
    sub.client_id = "c1"
    sub.client_secret = "s1"

    with patch("app.collectors.azure.activity_log.AzureClient") as client_cls:
        client_cls.return_value.list_subscription_diagnostic_settings.return_value = ([], 403)
        count = collect_activity_log(mock_db, sub)
    assert count == 0
    mock_db.execute.assert_not_called()


def test_privileged_role_name_matches_builtin_guids():
    owner_id = (
        "/subscriptions/sub/providers/Microsoft.Authorization/roleDefinitions/"
        "8e3af657-a8ff-443c-a75c-2fe8c4bcb635"
    )
    assert privileged_role_name(owner_id) == "Owner"
    assert privileged_role_name("unknown-guid") is None


def test_azure_client_list_role_assignments_pagination():
    with patch.object(AzureClient, "_access_token", return_value="tok"):
        with patch("app.services.azure_client.httpx.Client") as client_cls:
            client = MagicMock()
            client.__enter__.return_value = client
            client.__exit__.return_value = False
            client.request.side_effect = [
                _resp(
                    payload={
                        "value": [
                            {
                                "name": "assign-1",
                                "properties": {
                                    "roleDefinitionId": (
                                        "/providers/Microsoft.Authorization/roleDefinitions/"
                                        "8e3af657-a8ff-443c-a75c-2fe8c4bcb635"
                                    ),
                                    "principalId": "user-1",
                                    "principalType": "User",
                                    "scope": "/subscriptions/sub-1",
                                },
                            }
                        ],
                        "nextLink": "https://management.azure.com/next",
                    }
                ),
                _resp(payload={"value": []}),
            ]
            client_cls.return_value = client
            rows, status = AzureClient(
                tenant_id="t1", client_id="c1", client_secret="s1"
            ).list_role_assignments("sub-1")
    assert status == 200
    assert len(rows) == 1


def test_collect_entra_rbac_persists_privileged_assignments(mock_db):
    sub = MagicMock()
    sub.id = uuid.uuid4()
    sub.subscription_id = "sub-1"
    sub.tenant_id = "t1"
    sub.client_id = "c1"
    sub.client_secret = "s1"

    with patch("app.collectors.azure.entra_rbac.AzureClient") as client_cls:
        client_cls.return_value.list_role_assignments.return_value = (
            [
                {
                    "name": "assign-1",
                    "properties": {
                        "roleDefinitionId": (
                            "/providers/Microsoft.Authorization/roleDefinitions/"
                            "18d7d88d-d35e-4fb5-a5c3-7773c0cdfdd5"
                        ),
                        "principalId": "sp-1",
                        "principalType": "ServicePrincipal",
                        "scope": "/subscriptions/sub-1",
                    },
                },
                {
                    "name": "assign-2",
                    "properties": {
                        "roleDefinitionId": (
                            "/providers/Microsoft.Authorization/roleDefinitions/"
                            "acdd72a7-3385-48ef-bd42-f606fba81ae7"
                        ),
                        "principalId": "user-2",
                        "principalType": "User",
                        "scope": "/subscriptions/sub-1",
                    },
                },
            ],
            200,
        )
        count = collect_entra_rbac(mock_db, sub)
    assert count == 1
    mock_db.execute.assert_called_once()


def test_collect_entra_rbac_skips_on_forbidden(mock_db):
    sub = MagicMock()
    sub.id = uuid.uuid4()
    sub.subscription_id = "sub-1"
    sub.tenant_id = "t1"
    sub.client_id = "c1"
    sub.client_secret = "s1"

    with patch("app.collectors.azure.entra_rbac.AzureClient") as client_cls:
        client_cls.return_value.list_role_assignments.return_value = ([], 403)
        count = collect_entra_rbac(mock_db, sub)
    assert count == 0
    mock_db.execute.assert_not_called()


def test_azure_client_list_policy_states_pagination():
    with patch.object(AzureClient, "_access_token", return_value="tok"):
        with patch("app.services.azure_client.httpx.Client") as client_cls:
            client = MagicMock()
            client.__enter__.return_value = client
            client.__exit__.return_value = False
            client.request.side_effect = [
                _resp(
                    payload={
                        "value": [
                            {
                                "id": "state-1",
                                "properties": {
                                    "resourceId": "/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa1",
                                    "policyDefinitionName": "Storage HTTPS only",
                                    "policyAssignmentName": "security-baseline",
                                    "complianceState": "NonCompliant",
                                    "resourceType": "Microsoft.Storage/storageAccounts",
                                },
                            }
                        ],
                        "@odata.nextLink": "https://management.azure.com/next",
                    }
                ),
                _resp(payload={"value": []}),
            ]
            client_cls.return_value = client
            rows, status = AzureClient(
                tenant_id="t1", client_id="c1", client_secret="s1"
            ).list_policy_states("sub-1")
    assert status == 200
    assert len(rows) == 1


def test_azure_client_list_policy_states_soft_fail():
    with patch.object(AzureClient, "_access_token", return_value="tok"):
        with patch("app.services.azure_client.httpx.Client") as client_cls:
            client = MagicMock()
            client.__enter__.return_value = client
            client.__exit__.return_value = False
            client.request.return_value = _resp(status_code=403)
            client_cls.return_value = client
            rows, status = AzureClient(
                tenant_id="t1", client_id="c1", client_secret="s1"
            ).list_policy_states("sub-1")
    assert status == 403
    assert rows == []


def test_collect_policy_compliance_persists_non_compliant_states(mock_db):
    sub = MagicMock()
    sub.id = uuid.uuid4()
    sub.subscription_id = "sub-1"
    sub.tenant_id = "t1"
    sub.client_id = "c1"
    sub.client_secret = "s1"

    with patch("app.collectors.azure.policy_compliance.AzureClient") as client_cls:
        client_cls.return_value.list_policy_states.return_value = (
            [
                {
                    "id": "state-1",
                    "properties": {
                        "resourceId": "/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa1",
                        "policyDefinitionName": "Storage HTTPS only",
                        "policyAssignmentName": "security-baseline",
                        "complianceState": "NonCompliant",
                        "resourceType": "Microsoft.Storage/storageAccounts",
                    },
                }
            ],
            200,
        )
        count = collect_policy_compliance(mock_db, sub)
    assert count == 1
    assert mock_db.execute.call_count == 2


def test_collect_policy_compliance_skips_on_forbidden(mock_db):
    sub = MagicMock()
    sub.id = uuid.uuid4()
    sub.subscription_id = "sub-1"
    sub.tenant_id = "t1"
    sub.client_id = "c1"
    sub.client_secret = "s1"

    with patch("app.collectors.azure.policy_compliance.AzureClient") as client_cls:
        client_cls.return_value.list_policy_states.return_value = ([], 403)
        count = collect_policy_compliance(mock_db, sub)
    assert count == 0
    mock_db.execute.assert_not_called()
