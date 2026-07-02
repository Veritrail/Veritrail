"""Azure ARM REST client using client credentials."""
from __future__ import annotations

from typing import Any

import httpx

ARM_SCOPE = "https://management.azure.com/.default"
ARM_BASE = "https://management.azure.com"

PRIVILEGED_ROLE_GUIDS: dict[str, str] = {
    "8e3af657-a8ff-443c-a75c-2fe8c4bcb635": "Owner",
    "18d7d88d-d35e-4fb5-a5c3-7773c0cdfdd5": "User Access Administrator",
    "b24988ac-6180-42a0-ab88-20f7382dd24c": "Contributor",
    "f58310d9-a9f3-411c-86bb-37b4ce947241": "Role Based Access Control Administrator",
}


def privileged_role_name(role_definition_id: str) -> str | None:
    """Return the built-in role name when roleDefinitionId matches a privileged role."""
    rid = (role_definition_id or "").strip().lower()
    if not rid:
        return None
    guid = rid.rsplit("/", 1)[-1]
    for role_guid, role_name in PRIVILEGED_ROLE_GUIDS.items():
        if guid == role_guid:
            return role_name
    return None


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

    def _request_soft(self, method: str, path: str, **kwargs) -> tuple[dict[str, Any], int | None]:
        """Like _request but returns (payload, status_code) instead of raising on 4xx."""
        token = self._access_token()
        url = path if path.startswith("http") else f"{ARM_BASE}{path}"
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        with httpx.Client(timeout=30.0) as client:
            resp = client.request(method, url, headers=headers, **kwargs)
        if resp.status_code >= 400:
            return {}, resp.status_code
        if not resp.content:
            return {}, resp.status_code
        return resp.json(), resp.status_code

    def query_resource_graph(
        self,
        subscription_id: str,
        query: str,
    ) -> tuple[list[dict[str, Any]], int | None]:
        """Run a KQL query against Azure Resource Graph with $skipToken pagination."""
        sid = subscription_id.strip()
        subscription_uri = sid if sid.startswith("/subscriptions/") else f"/subscriptions/{sid}"
        url = "/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01"
        rows: list[dict[str, Any]] = []
        skip_token = ""
        last_status: int | None = 200
        while True:
            body: dict[str, Any] = {
                "subscriptions": [subscription_uri],
                "query": query,
            }
            options: dict[str, Any] = {"$top": 1000}
            if skip_token:
                options["$skipToken"] = skip_token
            body["options"] = options
            data, status = self._request_soft("POST", url, json=body)
            last_status = status
            if status and status >= 400:
                return rows, status
            rows.extend(list(data.get("data") or []))
            skip_token = str(data.get("$skipToken") or "")
            if not skip_token:
                break
        return rows, last_status

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
        rows, status = self.list_secure_scores_soft(subscription_id)
        if status and status >= 400:
            raise ValueError(f"Azure API error {status}")
        return rows

    def list_secure_scores_soft(
        self,
        subscription_id: str,
    ) -> tuple[list[dict[str, Any]], int | None]:
        sid = subscription_id.strip()
        data, status = self._request_soft(
            "GET",
            f"/subscriptions/{sid}/providers/Microsoft.Security/secureScores?api-version=2020-01-01",
        )
        if status and status >= 400:
            return [], status
        return list(data.get("value") or []), status

    def get_security_pricing(self, subscription_id: str) -> list[dict[str, Any]]:
        sid = subscription_id.strip()
        data = self._request(
            "GET",
            f"/subscriptions/{sid}/providers/Microsoft.Security/pricings?api-version=2024-01-01",
        )
        return list(data.get("value") or [])

    def list_storage_accounts(self, subscription_id: str) -> list[dict[str, Any]]:
        rows, status = self.list_storage_accounts_soft(subscription_id)
        if status and status >= 400:
            raise ValueError(f"Azure API error {status}")
        return rows

    def list_storage_accounts_soft(
        self,
        subscription_id: str,
    ) -> tuple[list[dict[str, Any]], int | None]:
        sid = subscription_id.strip()
        data, status = self._request_soft(
            "GET",
            f"/subscriptions/{sid}/providers/Microsoft.Storage/storageAccounts?api-version=2023-05-01",
        )
        if status and status >= 400:
            return [], status
        return list(data.get("value") or []), status

    def list_role_assignments(
        self,
        subscription_id: str,
    ) -> tuple[list[dict[str, Any]], int | None]:
        """List RBAC role assignments scoped to the subscription."""
        sid = subscription_id.strip()
        path = (
            f"/subscriptions/{sid}/providers/Microsoft.Authorization/roleAssignments"
            "?api-version=2022-04-01"
        )
        rows: list[dict[str, Any]] = []
        last_status: int | None = 200
        next_url = path
        while next_url:
            data, status = self._request_soft("GET", next_url)
            last_status = status
            if status and status >= 400:
                return rows, status
            rows.extend(list(data.get("value") or []))
            next_url = str(data.get("nextLink") or "")
        return rows, last_status

    def list_subscription_diagnostic_settings(
        self,
        subscription_id: str,
    ) -> tuple[list[dict[str, Any]], int | None]:
        """List diagnostic settings on the subscription (Activity Log export)."""
        sid = subscription_id.strip()
        data, status = self._request_soft(
            "GET",
            f"/subscriptions/{sid}/providers/microsoft.insights/diagnosticSettings?api-version=2021-05-01-preview",
        )
        if status and status >= 400:
            return [], status
        return list(data.get("value") or []), status

    def list_policy_states(
        self,
        subscription_id: str,
        *,
        compliance_filter: str | None = "NonCompliant",
    ) -> tuple[list[dict[str, Any]], int | None]:
        """List latest policy states for a subscription, optionally filtered by compliance."""
        sid = subscription_id.strip()
        filter_clause = ""
        if compliance_filter:
            filter_clause = f"&$filter=complianceState eq '{compliance_filter}'"
        path = (
            f"/subscriptions/{sid}/providers/Microsoft.PolicyInsights/policyStates/latest"
            f"/queryResults?api-version=2019-10-01&$top=1000{filter_clause}"
        )
        rows: list[dict[str, Any]] = []
        last_status: int | None = 200
        next_url = path
        while next_url:
            data, status = self._request_soft("GET", next_url)
            last_status = status
            if status and status >= 400:
                return rows, status
            rows.extend(list(data.get("value") or []))
            next_url = str(data.get("@odata.nextLink") or data.get("nextLink") or "")
        return rows, last_status
