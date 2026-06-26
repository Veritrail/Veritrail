"""Azure client and collector tests with mocked HTTP."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

from app.collectors.azure.defender import collect_defender
from app.collectors.azure.storage import collect_storage_accounts
from app.services.azure_client import AzureClient


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
