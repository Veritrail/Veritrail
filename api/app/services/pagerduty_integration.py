"""PagerDuty incident-workflow integration.

This connector deliberately reports operational-response evidence only: whether
PagerDuty services are configured and how many incidents remain open. It does
not claim to verify an incident-response program, triage quality, or exercises.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from app.services.integration_input import api_access_error

PAGERDUTY_PROVIDER_TYPE = "incident_pagerduty"
PAGERDUTY_API_URL = "https://api.pagerduty.com"
_HEADERS_VERSION = "application/vnd.pagerduty+json;version=2"


def public_config(cfg: dict[str, Any]) -> dict[str, Any]:
    return {
        "last_synced_at": cfg.get("last_synced_at"),
        "service_count": cfg.get("service_count"),
        "open_incident_count": cfg.get("open_incident_count"),
        "has_api_token": bool(cfg.get("api_token")),
    }


def _headers(api_token: str) -> dict[str, str]:
    return {
        "Authorization": f"Token token={api_token}",
        "Accept": _HEADERS_VERSION,
    }


def verify_connection(cfg: dict[str, Any]) -> dict[str, Any]:
    token = (cfg.get("api_token") or "").strip()
    if not token:
        raise ValueError("PagerDuty requires an API access token")
    with httpx.Client(timeout=30.0) as client:
        response = client.get(
            f"{PAGERDUTY_API_URL}/users",
            headers=_headers(token),
            params={"limit": 1},
        )
    if response.status_code >= 400:
        raise ValueError(
            api_access_error(
                "PagerDuty",
                response.status_code,
                hint="Use a REST API access token with read access to services and incidents.",
            )
        )
    return {"ok": True}


def _count_collection(client: httpx.Client, path: str, token: str, params: list[tuple[str, str]]) -> int:
    total = 0
    offset = 0
    while True:
        response = client.get(
            f"{PAGERDUTY_API_URL}{path}",
            headers=_headers(token),
            params=[*params, ("limit", "100"), ("offset", str(offset))],
        )
        if response.status_code >= 400:
            raise ValueError(f"PagerDuty sync error {response.status_code}")
        payload = response.json()
        values = payload.get("services") or payload.get("incidents") or []
        total += len(values)
        if not payload.get("more"):
            return total
        offset += len(values)


def sync_summary(cfg: dict[str, Any]) -> dict[str, Any]:
    token = (cfg.get("api_token") or "").strip()
    if not token:
        raise ValueError("PagerDuty requires an API access token")
    with httpx.Client(timeout=60.0) as client:
        services = _count_collection(client, "/services", token, [])
        open_incidents = _count_collection(
            client,
            "/incidents",
            token,
            [("statuses[]", "triggered"), ("statuses[]", "acknowledged")],
        )
    return {
        "service_count": services,
        "open_incident_count": open_incidents,
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
    }
