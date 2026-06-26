"""GCP API client — Workload Identity Federation (production) or legacy SA JSON."""
from __future__ import annotations

import json
from typing import Any

import httpx

from app.models.gcp_project import GcpProject
from app.services.gcp_impersonation import (
    AUTH_SERVICE_ACCOUNT_IMPERSONATION,
    exchange_impersonation_access_token,
)
from app.services.gcp_wif import (
    AUTH_SERVICE_ACCOUNT_KEY,
    AUTH_WORKLOAD_IDENTITY,
    GCP_SCOPE,
    build_wif_audience,
    exchange_wif_access_token,
)

__all__ = ["GcpClient", "GCP_SCOPE"]


class GcpClient:
    def __init__(self, service_account_json: str | None = None, *, _access_token_fn=None):
        self._access_token_fn = _access_token_fn
        self._info: dict[str, Any] | None = None
        self.project_id = ""
        if service_account_json:
            raw = service_account_json.strip()
            if not raw:
                raise ValueError("GCP service account JSON is required")
            try:
                self._info = json.loads(raw)
            except json.JSONDecodeError as e:
                raise ValueError("GCP service account JSON is invalid") from e
            if not self._info.get("client_email") or not self._info.get("private_key"):
                raise ValueError("GCP service account JSON must include client_email and private_key")
            self.project_id = self._info.get("project_id") or ""

    @classmethod
    def from_project(cls, project: GcpProject) -> GcpClient:
        method = (project.auth_method or AUTH_WORKLOAD_IDENTITY).strip()
        if method == AUTH_SERVICE_ACCOUNT_KEY:
            if not project.service_account_json:
                raise ValueError("GCP service account JSON is required for service_account_key auth")
            return cls(project.service_account_json)
        if method == AUTH_SERVICE_ACCOUNT_IMPERSONATION:
            if not project.service_account_email:
                raise ValueError("GCP scanner service account email is required for impersonation auth")
            return cls(
                _access_token_fn=lambda: exchange_impersonation_access_token(
                    service_account_email=project.service_account_email,
                ),
            )
        if method != AUTH_WORKLOAD_IDENTITY:
            raise ValueError(f"Unsupported GCP auth_method: {method}")
        return cls(_access_token_fn=lambda: _wif_token_for_project(project))

    def _access_token(self) -> str:
        if self._access_token_fn is not None:
            return self._access_token_fn()
        if not self._info:
            raise ValueError("GCP credentials are not configured")
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


def _wif_token_for_project(project: GcpProject) -> str:
    if not project.wif_subject:
        raise ValueError("GCP WIF subject is not configured")
    if not project.service_account_email:
        raise ValueError("GCP service account email is required for WIF")
    if not project.project_number or not project.pool_id or not project.provider_id:
        raise ValueError("GCP WIF pool, provider, and project number are required")
    audience = project.wif_audience or build_wif_audience(
        project.project_number,
        project.pool_id,
        project.provider_id,
    )
    return exchange_wif_access_token(
        wif_subject=project.wif_subject,
        audience=audience,
        service_account_email=project.service_account_email,
    )
