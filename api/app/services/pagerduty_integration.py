"""PagerDuty incident-workflow integration.

This connector deliberately reports operational-response evidence only: whether
PagerDuty services/schedules are configured and how incidents are handled. It
does not claim to verify an incident-response program, triage quality, or
exercises — and is never treated as threat-detection telemetry.
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
        "schedule_count": cfg.get("schedule_count"),
        "escalation_policy_count": cfg.get("escalation_policy_count"),
        "open_incident_count": cfg.get("open_incident_count"),
        "acknowledged_incident_count": cfg.get("acknowledged_incident_count"),
        "resolved_incident_count_7d": cfg.get("resolved_incident_count_7d"),
        "has_api_token": bool(cfg.get("api_token")),
        "has_capability_evidence": bool(cfg.get("capability_evidence")),
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


def _count_collection(
    client: httpx.Client,
    path: str,
    token: str,
    params: list[tuple[str, str]],
    *,
    key: str,
) -> int:
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
        values = payload.get(key) or []
        total += len(values)
        if not payload.get("more"):
            return total
        offset += len(values)


def sync_summary(cfg: dict[str, Any]) -> dict[str, Any]:
    from app.services.operational_capability import grade_pagerduty_from_config

    token = (cfg.get("api_token") or "").strip()
    if not token:
        raise ValueError("PagerDuty requires an API access token")
    with httpx.Client(timeout=60.0) as client:
        services = _count_collection(client, "/services", token, [], key="services")
        schedules = _count_collection(client, "/schedules", token, [], key="schedules")
        escalations = _count_collection(
            client, "/escalation_policies", token, [], key="escalation_policies"
        )
        open_incidents = _count_collection(
            client,
            "/incidents",
            token,
            [("statuses[]", "triggered"), ("statuses[]", "acknowledged")],
            key="incidents",
        )
        acknowledged = _count_collection(
            client,
            "/incidents",
            token,
            [("statuses[]", "acknowledged")],
            key="incidents",
        )
        since = (datetime.now(timezone.utc).replace(microsecond=0)).isoformat().replace("+00:00", "Z")
        # resolved in last 7d — best-effort; ignore failures
        resolved_recent = 0
        try:
            from datetime import timedelta

            since_dt = datetime.now(timezone.utc) - timedelta(days=7)
            since = since_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            resolved_recent = _count_collection(
                client,
                "/incidents",
                token,
                [("statuses[]", "resolved"), ("since", since)],
                key="incidents",
            )
        except ValueError:
            resolved_recent = 0

    now = datetime.now(timezone.utc).isoformat()
    summary = {
        "service_count": services,
        "schedule_count": schedules,
        "escalation_policy_count": escalations,
        "open_incident_count": open_incidents,
        "acknowledged_incident_count": acknowledged,
        "resolved_incident_count_7d": resolved_recent,
        "last_synced_at": now,
    }
    summary["capability_evidence"] = grade_pagerduty_from_config({**cfg, **summary})
    return summary
