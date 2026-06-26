"""Azure ARM REST client using client credentials."""
from __future__ import annotations

from typing import Any

import httpx

ARM_SCOPE = "https://management.azure.com/.default"
ARM_BASE = "https://management.azure.com"


class AzureClient:
    def __init__(self, *, tenant_id: str, client_id: str, client_secret: str):
        self.tenant_id = (tenant_id or "").strip()
        self.client_id = (client_id or "").strip()
        self.client_secret = (client_secret or "").strip()
        if not all([self.tenant_id, self.client_id, self.client_secret]):
            raise ValueError("Azure tenant_id, client_id, and client_secret are required")

    def _access_token(self) -> str:
        url = f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token"
        data = {
            "grant_type": "client_credentials",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "scope": ARM_SCOPE,
        }
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(url, data=data)
        if resp.status_code >= 400:
            raise ValueError("Azure client credentials rejected")
        token = resp.json().get("access_token")
        if not token:
            raise ValueError("Azure token response missing access_token")
        return token

    def _request(self, method: str, path: str, **kwargs) -> dict[str, Any]:
        token = self._access_token()
        url = path if path.startswith("http") else f"{ARM_BASE}{path}"
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        with httpx.Client(timeout=30.0) as client:
            resp = client.request(method, url, headers=headers, **kwargs)
        if resp.status_code == 401:
            raise ValueError("Azure credentials unauthorized")
        if resp.status_code == 403:
            raise ValueError("Azure credentials lack required permissions")
        if resp.status_code >= 400:
            raise ValueError(f"Azure API error {resp.status_code}: {resp.text[:300]}")
        if not resp.content:
            return {}
        return resp.json()

    def verify(self, subscription_id: str) -> dict[str, Any]:
        sid = subscription_id.strip()
        data = self._request(
            "GET",
            f"/subscriptions/{sid}?api-version=2022-12-01",
        )
        return {
            "subscription_id": data.get("subscriptionId") or sid,
            "display_name": data.get("displayName"),
            "state": data.get("state"),
        }

    def list_secure_scores(self, subscription_id: str) -> list[dict[str, Any]]:
        sid = subscription_id.strip()
        data = self._request(
            "GET",
            f"/subscriptions/{sid}/providers/Microsoft.Security/secureScores?api-version=2020-01-01",
        )
        return list(data.get("value") or [])

    def get_security_pricing(self, subscription_id: str) -> list[dict[str, Any]]:
        sid = subscription_id.strip()
        data = self._request(
            "GET",
            f"/subscriptions/{sid}/providers/Microsoft.Security/pricings?api-version=2024-01-01",
        )
        return list(data.get("value") or [])

    def list_storage_accounts(self, subscription_id: str) -> list[dict[str, Any]]:
        sid = subscription_id.strip()
        data = self._request(
            "GET",
            f"/subscriptions/{sid}/providers/Microsoft.Storage/storageAccounts?api-version=2023-05-01",
        )
        return list(data.get("value") or [])
