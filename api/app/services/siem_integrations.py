"""SIEM / monitoring integrations (Splunk, Datadog, Elastic)."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import httpx

from app.services.integration_input import (
    api_access_error,
    normalize_api_base_url,
    normalize_datadog_site,
    normalize_snyk_org_id,
)

SIEM_TYPES = {
    "splunk": "siem_splunk",
    "datadog": "siem_datadog",
    "elastic": "siem_elastic",
}

SIEM_LABELS = {
    "splunk": "Splunk",
    "datadog": "Datadog",
    "elastic": "Elastic (Sentinel)",
}


def siem_type_for_vendor(vendor: str) -> str:
    key = (vendor or "").strip().lower()
    if key not in SIEM_TYPES:
        raise ValueError(f"Unsupported SIEM vendor: {vendor}")
    return SIEM_TYPES[key]


def public_config(vendor: str, cfg: dict[str, Any]) -> dict[str, Any]:
    key = vendor.lower()
    base = {
        "vendor": key,
        "label": SIEM_LABELS.get(key, key),
        "last_synced_at": cfg.get("last_synced_at"),
        "signal_count": cfg.get("signal_count"),
    }
    if key == "splunk":
        base.update(
            {
                "base_url": cfg.get("base_url"),
                "index": cfg.get("index"),
                "has_token": bool(cfg.get("api_token")),
            }
        )
    elif key == "datadog":
        base.update(
            {
                "site": cfg.get("site") or "datadoghq.com",
                "has_api_key": bool(cfg.get("api_key")),
                "has_app_key": bool(cfg.get("app_key")),
            }
        )
    elif key == "elastic":
        base.update(
            {
                "cluster_url": cfg.get("cluster_url"),
                "has_api_key": bool(cfg.get("api_key")),
            }
        )
    return base


def verify_siem_connection(vendor: str, cfg: dict[str, Any]) -> dict[str, Any]:
    key = vendor.lower()
    if key == "splunk":
        return _test_splunk(cfg)
    if key == "datadog":
        return _test_datadog(cfg)
    if key == "elastic":
        return _test_elastic(cfg)
    raise ValueError(f"Unsupported SIEM vendor: {vendor}")


def sync_summary(vendor: str, cfg: dict[str, Any]) -> dict[str, Any]:
    from app.services.operational_capability import grade_siem_from_config

    key = vendor.lower()
    extras: dict[str, Any] = {}
    if key == "splunk":
        count = _splunk_signal_count(cfg)
        # This query proves log ingestion only. It does not inspect Splunk ES
        # correlation searches, notable events, or alert health.
        extras.update(
            {
                "logging_event_count": count,
                "security_signal_count": 0,
                "security_rules_enabled": False,
                "ingestion_fresh": count > 0,
                "security_detection_unassessed": True,
            }
        )
    elif key == "datadog":
        count, extras = _datadog_signal_detail(cfg)
    elif key == "elastic":
        count, extras = _elastic_signal_detail(cfg)
    else:
        raise ValueError(f"Unsupported SIEM vendor: {vendor}")
    now = datetime.now(timezone.utc).isoformat()
    merged = {**cfg, "signal_count": count, "last_synced_at": now, **extras}
    return {
        "signal_count": count,
        "last_synced_at": now,
        **extras,
        "capability_evidence": grade_siem_from_config(key, merged),
    }


def _test_splunk(cfg: dict[str, Any]) -> dict[str, Any]:
    base = normalize_api_base_url(cfg.get("base_url") or "")
    token = (cfg.get("api_token") or "").strip()
    if not base or not token:
        raise ValueError("Splunk requires base_url and api_token")
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(
            f"{base}/services/server/info",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            params={"output_mode": "json"},
        )
    if resp.status_code >= 400:
        raise ValueError(api_access_error("Splunk", resp.status_code, hint="Use Splunk management URL origin only."))
    return {"ok": True, "vendor": "splunk"}


def _splunk_signal_count(cfg: dict[str, Any]) -> int:
    base = normalize_api_base_url(cfg.get("base_url") or "")
    token = (cfg.get("api_token") or "").strip()
    index = (cfg.get("index") or "main").strip()
    query = f"search index={index} earliest=-24h | stats count"
    with httpx.Client(timeout=60.0) as client:
        resp = client.post(
            f"{base}/services/search/jobs/export",
            headers={"Authorization": f"Bearer {token}"},
            data={"search": query, "output_mode": "json"},
        )
    if resp.status_code >= 400:
        raise ValueError(f"Splunk sync error {resp.status_code}")
    count = 0
    for line in (resp.text or "").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
            count = int((row.get("result") or row).get("count") or count)
        except (json.JSONDecodeError, ValueError, TypeError):
            continue
    return count


def _test_datadog(cfg: dict[str, Any]) -> dict[str, Any]:
    site = normalize_datadog_site(cfg.get("site") or "datadoghq.com")
    api_key = (cfg.get("api_key") or "").strip()
    app_key = (cfg.get("app_key") or "").strip()
    if not api_key or not app_key:
        raise ValueError("Datadog requires api_key and app_key")
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(
            f"https://api.{site}/api/v1/validate",
            headers={"DD-API-KEY": api_key, "DD-APPLICATION-KEY": app_key},
        )
    if resp.status_code >= 400:
        raise ValueError(api_access_error("Datadog", resp.status_code, hint="Use site hostname (e.g. datadoghq.com)."))
    return {"ok": True, "vendor": "datadog"}


def _datadog_signal_count(cfg: dict[str, Any]) -> int:
    count, _ = _datadog_signal_detail(cfg)
    return count


def _datadog_signal_detail(cfg: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    site = normalize_datadog_site(cfg.get("site") or "datadoghq.com")
    headers = {"DD-API-KEY": cfg["api_key"], "DD-APPLICATION-KEY": cfg["app_key"]}
    with httpx.Client(timeout=60.0) as client:
        resp = client.get(
            f"https://api.{site}/api/v1/monitor",
            headers=headers,
            params={"monitor_tags": "security", "page_size": 100},
        )
    if resp.status_code >= 400:
        raise ValueError(f"Datadog sync error {resp.status_code}")
    monitors = resp.json() if isinstance(resp.json(), list) else []
    alerted = [m for m in monitors if (m.get("overall_state") or "").upper() in {"ALERT", "WARN"}]
    return len(alerted), {
        "monitor_count": len(monitors),
        # /api/v1/monitor returns general monitors, not Cloud SIEM rules.
        "security_rules_enabled": False,
        "security_signal_count": 0,
        "logging_event_count": len(monitors),
        "security_detection_unassessed": True,
        "ingestion_fresh": len(alerted) > 0 or len(monitors) > 0,
    }


def _test_elastic(cfg: dict[str, Any]) -> dict[str, Any]:
    cluster = normalize_api_base_url(cfg.get("cluster_url") or "")
    api_key = (cfg.get("api_key") or "").strip()
    if not cluster or not api_key:
        raise ValueError("Elastic requires cluster_url and api_key")
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(
            f"{cluster}/_cluster/health",
            headers={"Authorization": f"ApiKey {api_key}"},
        )
    if resp.status_code >= 400:
        raise ValueError(api_access_error("Elastic", resp.status_code, hint="Use cluster URL origin only."))
    return {"ok": True, "vendor": "elastic"}


def _elastic_signal_count(cfg: dict[str, Any]) -> int:
    count, _ = _elastic_signal_detail(cfg)
    return count


def _elastic_signal_detail(cfg: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    cluster = normalize_api_base_url(cfg.get("cluster_url") or "")
    headers = {"Authorization": f"ApiKey {cfg['api_key']}", "Content-Type": "application/json"}
    body = {
        "size": 0,
        "query": {"range": {"@timestamp": {"gte": "now-24h"}}},
    }
    with httpx.Client(timeout=60.0) as client:
        resp = client.post(
            f"{cluster}/.alerts-security.alerts-default/_search",
            headers=headers,
            json=body,
        )
    if resp.status_code == 404:
        return 0, {"has_security_index": False, "ingestion_fresh": False}
    if resp.status_code >= 400:
        raise ValueError(f"Elastic sync error {resp.status_code}")
    count = int(resp.json().get("hits", {}).get("total", {}).get("value", 0))
    return count, {
        "has_security_index": True,
        # A populated Security alert index is direct detection activity. An
        # empty index alone does not prove rules are enabled and healthy.
        "security_rules_enabled": count > 0,
        "security_signal_count": count,
        "logging_event_count": count,
        "ingestion_fresh": count > 0,
        "high_signals": count,
    }
