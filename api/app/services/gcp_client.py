"""GCP API client using service account JSON and google-auth."""
from __future__ import annotations

import json
from typing import Any

import httpx

GCP_SCOPE = "https://www.googleapis.com/auth/cloud-platform"


class GcpClient:
    def __init__(self, service_account_json: str):
        raw = (service_account_json or "").strip()
        if not raw:
            raise ValueError("GCP service account JSON is required")
        try:
            self._info = json.loads(raw)
        except json.JSONDecodeError as e:
            raise ValueError("GCP service account JSON is invalid") from e
        if not self._info.get("client_email") or not self._info.get("private_key"):
            raise ValueError("GCP service account JSON must include client_email and private_key")
        self.project_id = self._info.get("project_id") or ""

    def _access_token(self) -> str:
        try:
            from google.auth.transport.requests import Request
            from google.oauth2 import service_account
        except ImportError as e:
            raise ValueError("google-auth package is required for GCP integration") from e

        creds = service_account.Credentials.from_service_account_info(
            self._info,
            scopes=[GCP_SCOPE],
        )
        creds.refresh(Request())
        if not creds.token:
            raise ValueError("Failed to obtain GCP access token")
        return creds.token

    def _request(self, method: str, url: str, **kwargs) -> dict[str, Any]:
        token = self._access_token()
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        with httpx.Client(timeout=30.0) as client:
            resp = client.request(method, url, headers=headers, **kwargs)
        if resp.status_code == 401:
            raise ValueError("GCP credentials unauthorized")
        if resp.status_code == 403:
            raise ValueError("GCP credentials lack required permissions")
        if resp.status_code >= 400:
            detail = resp.text[:300]
            raise ValueError(f"GCP API error {resp.status_code}: {detail}")
        if not resp.content:
            return {}
        return resp.json()

    def verify(self, project_id: str) -> dict[str, Any]:
        pid = (project_id or self.project_id or "").strip()
        if not pid:
            raise ValueError("GCP project ID is required")
        data = self._request(
            "GET",
            f"https://cloudresourcemanager.googleapis.com/v1/projects/{pid}",
        )
        return {
            "project_id": data.get("projectId") or pid,
            "name": data.get("name"),
            "project_number": data.get("projectNumber"),
        }

    def list_logging_sinks(self, project_id: str) -> list[dict[str, Any]]:
        pid = project_id.strip()
        data = self._request(
            "GET",
            f"https://logging.googleapis.com/v2/projects/{pid}/sinks",
        )
        return list(data.get("sinks") or [])

    def list_compute_instances(self, project_id: str) -> list[dict[str, Any]]:
        pid = project_id.strip()
        data = self._request(
            "GET",
            f"https://compute.googleapis.com/compute/v1/projects/{pid}/aggregated/instances",
        )
        instances: list[dict[str, Any]] = []
        for _zone, scoped in (data.get("items") or {}).items():
            for inst in scoped.get("instances") or []:
                instances.append(inst)
        return instances
