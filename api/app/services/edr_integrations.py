"""CrowdStrike and SentinelOne endpoint evidence connectors (Phase 4).

Machine-verifiable device denominator, sensor/agent health, and vulnerability /
detection evidence where licensed APIs expose it. Human endpoint-policy admin
remains out of scope.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin

import httpx

from app.services.integration_input import api_access_error, normalize_api_base_url
from app.services.technical_capability import OpenFindingsSummary, envelope

EDR_TYPES = {
    "crowdstrike": "edr_crowdstrike",
    "sentinelone": "edr_sentinelone",
}

EDR_LABELS = {
    "crowdstrike": "CrowdStrike",
    "sentinelone": "SentinelOne",
}

DEFAULT_CROWDSTRIKE_BASE = "https://api.crowdstrike.com"


def edr_type_for_vendor(vendor: str) -> str:
    key = (vendor or "").strip().lower()
    if key not in EDR_TYPES:
        raise ValueError(f"Unsupported EDR vendor: {vendor}")
    return EDR_TYPES[key]


def public_config(vendor: str, cfg: dict[str, Any]) -> dict[str, Any]:
    key = vendor.lower()
    base = {
        "vendor": key,
        "label": EDR_LABELS.get(key, key),
        "last_synced_at": cfg.get("last_synced_at"),
        "device_count": cfg.get("device_count"),
        "healthy_device_count": cfg.get("healthy_device_count"),
        "open_findings_count": cfg.get("open_findings_count"),
        "has_capability_evidence": bool(cfg.get("capability_evidence")),
    }
    if key == "crowdstrike":
        base.update(
            {
                "base_url": cfg.get("base_url") or DEFAULT_CROWDSTRIKE_BASE,
                "has_client_id": bool(cfg.get("client_id")),
                "has_client_secret": bool(cfg.get("client_secret")),
            }
        )
    elif key == "sentinelone":
        base.update(
            {
                "management_url": cfg.get("management_url"),
                "has_api_token": bool(cfg.get("api_token")),
            }
        )
    return base


def verify_edr_connection(vendor: str, cfg: dict[str, Any]) -> dict[str, Any]:
    key = vendor.lower()
    if key == "crowdstrike":
        token = _crowdstrike_token(cfg)
        base = normalize_api_base_url(cfg.get("base_url") or DEFAULT_CROWDSTRIKE_BASE)
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(
                f"{base}/devices/queries/devices/v1",
                headers={"Authorization": f"Bearer {token}"},
                params={"limit": 1},
            )
        if resp.status_code >= 400:
            raise ValueError(
                api_access_error(
                    "CrowdStrike",
                    resp.status_code,
                    hint="Use an API client with Hosts read scope; set base_url for your cloud region.",
                )
            )
        return {"ok": True, "vendor": "crowdstrike"}
    if key == "sentinelone":
        mgmt = normalize_api_base_url(cfg.get("management_url") or "")
        token = (cfg.get("api_token") or "").strip()
        if not mgmt or not token:
            raise ValueError("SentinelOne requires management_url and api_token")
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(
                urljoin(mgmt.rstrip("/") + "/", "web/api/v2.1/agents"),
                headers={"Authorization": f"ApiToken {token}"},
                params={"limit": 1},
            )
        if resp.status_code >= 400:
            raise ValueError(
                api_access_error(
                    "SentinelOne",
                    resp.status_code,
                    hint="Use a management console URL and API token with Agents read permission.",
                )
            )
        return {"ok": True, "vendor": "sentinelone"}
    raise ValueError(f"Unsupported EDR vendor: {vendor}")


def sync_summary(vendor: str, cfg: dict[str, Any]) -> dict[str, Any]:
    key = vendor.lower()
    if key == "crowdstrike":
        return _sync_crowdstrike(cfg)
    if key == "sentinelone":
        return _sync_sentinelone(cfg)
    raise ValueError(f"Unsupported EDR vendor: {vendor}")


def _crowdstrike_token(cfg: dict[str, Any]) -> str:
    base = normalize_api_base_url(cfg.get("base_url") or DEFAULT_CROWDSTRIKE_BASE)
    client_id = (cfg.get("client_id") or "").strip()
    client_secret = (cfg.get("client_secret") or "").strip()
    if not client_id or not client_secret:
        raise ValueError("CrowdStrike requires client_id and client_secret")
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(
            f"{base}/oauth2/token",
            data={"client_id": client_id, "client_secret": client_secret},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if resp.status_code >= 400:
        raise ValueError(api_access_error("CrowdStrike", resp.status_code, hint="Check OAuth client credentials and base_url."))
    token = resp.json().get("access_token")
    if not token:
        raise ValueError("CrowdStrike token response missing access_token")
    return str(token)


def _sync_crowdstrike(cfg: dict[str, Any]) -> dict[str, Any]:
    base = normalize_api_base_url(cfg.get("base_url") or DEFAULT_CROWDSTRIKE_BASE)
    token = _crowdstrike_token(cfg)
    headers = {"Authorization": f"Bearer {token}"}
    device_ids: list[str] = []
    with httpx.Client(timeout=60.0) as client:
        offset = 0
        seen_offsets: set[int] = set()
        while offset not in seen_offsets:
            seen_offsets.add(offset)
            params: dict[str, Any] = {"limit": 100, "offset": offset}
            resp = client.get(f"{base}/devices/queries/devices/v1", headers=headers, params=params)
            if resp.status_code >= 400:
                raise ValueError(f"CrowdStrike hosts query error {resp.status_code}")
            payload = resp.json()
            resources = list(payload.get("resources") or [])
            device_ids.extend(str(r) for r in resources)
            meta = payload.get("meta") or {}
            pagination = meta.get("pagination") or {}
            total = int(pagination.get("total") or 0)
            if not resources or len(resources) < 100 or (total and len(device_ids) >= total):
                break
            offset += len(resources)

        healthy = 0
        for i in range(0, len(device_ids), 50):
            batch = device_ids[i : i + 50]
            if not batch:
                break
            detail = client.get(
                f"{base}/devices/entities/devices/v2",
                headers=headers,
                params=[("ids", d) for d in batch],
            )
            if detail.status_code >= 400:
                continue
            for host in detail.json().get("resources") or []:
                status = str(host.get("status") or host.get("state") or "").lower()
                last_seen = host.get("last_seen") or host.get("last_seen_timestamp")
                if status in {"normal", "online", ""} and last_seen:
                    healthy += 1

        open_findings = 0
        critical = high = medium = low = 0
        vuln_limitations: list[str] = []
        after: str | None = None
        seen_after: set[str] = set()
        while True:
            params: dict[str, Any] = {"limit": 100, "filter": "status:'open'"}
            if after:
                params["after"] = after
            vuln = client.get(
                f"{base}/spotlight/combined/vulnerabilities/v1",
                headers=headers,
                params=params,
            )
            if vuln.status_code == 403:
                vuln_limitations.append("spotlight_vulnerabilities_not_licensed")
                break
            if vuln.status_code == 404:
                vuln_limitations.append("spotlight_vulnerabilities_unavailable")
                break
            if vuln.status_code >= 400:
                vuln_limitations.append(f"spotlight_query_error_{vuln.status_code}")
                break
            payload = vuln.json()
            rows = list(payload.get("resources") or [])
            for row in rows:
                open_findings += 1
                sev = str(row.get("severity") or row.get("cve", {}).get("severity") or "").upper()
                if sev in ("CRITICAL", "5", "4"):
                    critical += 1
                elif sev in ("HIGH", "3"):
                    high += 1
                elif sev in ("MEDIUM", "2"):
                    medium += 1
                else:
                    low += 1
            next_after = str(((payload.get("meta") or {}).get("pagination") or {}).get("after") or "")
            if not rows or not next_after or next_after in seen_after:
                break
            seen_after.add(next_after)
            after = next_after

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    device_count = len(device_ids)
    has_activity = healthy > 0 or open_findings > 0
    env = envelope(
        capability="host_workload_scanning",
        provider="crowdstrike",
        scope_type="tenant",
        scope_id=cfg.get("base_url") or DEFAULT_CROWDSTRIKE_BASE,
        asset_type="managed_device",
        enabled=device_count > 0,
        has_observable_activity=has_activity,
        last_observed_at=now_iso,
        last_successful_scan_at=now_iso if has_activity else None,
        eligible=device_count,
        assessed=healthy,
        open_findings=OpenFindingsSummary(critical=critical, high=high, medium=medium, low=low),
        source_reference="crowdstrike:hosts",
        limitations=vuln_limitations
        + ([] if device_count else ["no_managed_devices"])
        + ([] if healthy == device_count or device_count == 0 else ["partial_sensor_health"]),
        now=now,
    )
    return {
        "device_count": device_count,
        "healthy_device_count": healthy,
        "open_findings_count": open_findings,
        "last_synced_at": now_iso,
        "capability_evidence": [env.as_dict()],
    }


def _sync_sentinelone(cfg: dict[str, Any]) -> dict[str, Any]:
    mgmt = normalize_api_base_url(cfg.get("management_url") or "")
    token = (cfg.get("api_token") or "").strip()
    if not mgmt or not token:
        raise ValueError("SentinelOne requires management_url and api_token")
    headers = {"Authorization": f"ApiToken {token}"}
    agents: list[dict[str, Any]] = []
    with httpx.Client(timeout=60.0) as client:
        cursor: str | None = None
        seen_agent_cursors: set[str] = set()
        while True:
            params: dict[str, Any] = {"limit": 100}
            if cursor:
                params["cursor"] = cursor
            resp = client.get(
                urljoin(mgmt.rstrip("/") + "/", "web/api/v2.1/agents"),
                headers=headers,
                params=params,
            )
            if resp.status_code >= 400:
                raise ValueError(f"SentinelOne agents error {resp.status_code}")
            payload = resp.json()
            batch = list(payload.get("data") or [])
            agents.extend(batch)
            pagination = payload.get("pagination") or {}
            next_cursor = str(pagination.get("nextCursor") or "")
            if not batch or not next_cursor or next_cursor in seen_agent_cursors:
                break
            seen_agent_cursors.add(next_cursor)
            cursor = next_cursor

        healthy = sum(
            1
            for a in agents
            if a.get("isActive") is True
            or str(a.get("networkStatus") or "").lower() in {"connected", "online"}
        )

        open_findings = 0
        critical = high = medium = low = 0
        limitations: list[str] = []
        threat_cursor: str | None = None
        seen_threat_cursors: set[str] = set()
        while True:
            params: dict[str, Any] = {"limit": 100, "resolved": "false"}
            if threat_cursor:
                params["cursor"] = threat_cursor
            threats = client.get(
                urljoin(mgmt.rstrip("/") + "/", "web/api/v2.1/threats"),
                headers=headers,
                params=params,
            )
            if threats.status_code == 403:
                limitations.append("threats_api_forbidden")
                break
            if threats.status_code >= 400:
                limitations.append(f"threats_query_error_{threats.status_code}")
                break
            payload = threats.json()
            rows = list(payload.get("data") or [])
            for row in rows:
                open_findings += 1
                conf = str(row.get("confidenceLevel") or row.get("threatInfo", {}).get("confidenceLevel") or "").upper()
                if conf in ("MALICIOUS", "CRITICAL", "HIGH"):
                    if conf == "CRITICAL":
                        critical += 1
                    else:
                        high += 1
                elif conf in ("SUSPICIOUS", "MEDIUM"):
                    medium += 1
                else:
                    low += 1
            next_cursor = str((payload.get("pagination") or {}).get("nextCursor") or "")
            if not rows or not next_cursor or next_cursor in seen_threat_cursors:
                break
            seen_threat_cursors.add(next_cursor)
            threat_cursor = next_cursor

        # Optional vulnerability module
        vulns = client.get(
            urljoin(mgmt.rstrip("/") + "/", "web/api/v2.1/installed-applications"),
            headers=headers,
            params={"limit": 1},
        )
        if vulns.status_code in (403, 404):
            limitations.append("vulnerability_module_not_available")

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    device_count = len(agents)
    has_activity = healthy > 0 or open_findings > 0
    env = envelope(
        capability="host_workload_scanning",
        provider="sentinelone",
        scope_type="tenant",
        scope_id=mgmt,
        asset_type="managed_device",
        enabled=device_count > 0,
        has_observable_activity=has_activity,
        last_observed_at=now_iso,
        last_successful_scan_at=now_iso if has_activity else None,
        eligible=device_count,
        assessed=healthy,
        open_findings=OpenFindingsSummary(critical=critical, high=high, medium=medium, low=low),
        source_reference="sentinelone:agents",
        limitations=limitations
        + ([] if device_count else ["no_managed_agents"])
        + ([] if healthy == device_count or device_count == 0 else ["partial_agent_health"]),
        now=now,
    )
    return {
        "device_count": device_count,
        "healthy_device_count": healthy,
        "open_findings_count": open_findings,
        "last_synced_at": now_iso,
        "capability_evidence": [env.as_dict()],
    }


def envelopes_from_edr_config(cfg: dict[str, Any], *, now: datetime | None = None):
    """Rebuild EvidenceEnvelope list from stored provider config."""
    from app.services.technical_capability import CoverageCounts, EvidenceEnvelope as EE

    ref = now or datetime.now(timezone.utc)
    raw = cfg.get("capability_evidence")
    if not isinstance(raw, list):
        return []
    out = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        of = row.get("open_findings") if isinstance(row.get("open_findings"), dict) else {}
        cov = row.get("coverage") if isinstance(row.get("coverage"), dict) else {}
        status = row.get("status") or "unknown"
        out.append(
            EE(
                capability=row.get("capability") or "host_workload_scanning",  # type: ignore[arg-type]
                provider=str(row.get("provider") or "edr"),
                scope_type=str(row.get("scope_type") or "tenant"),
                scope_id=str(row.get("scope_id") or "default"),
                asset_type=str(row.get("asset_type") or "managed_device"),
                status=status,  # type: ignore[arg-type]
                enabled=bool(row.get("enabled")),
                last_observed_at=row.get("last_observed_at"),
                last_successful_scan_at=row.get("last_successful_scan_at"),
                coverage=CoverageCounts(
                    eligible=int(cov.get("eligible") or 0),
                    assessed=int(cov.get("assessed") or 0),
                    excluded=int(cov.get("excluded") or 0),
                ),
                open_findings=OpenFindingsSummary(
                    critical=int(of.get("critical") or 0),
                    high=int(of.get("high") or 0),
                    medium=int(of.get("medium") or 0),
                    low=int(of.get("low") or 0),
                ),
                source_reference=row.get("source_reference"),
                limitations=list(row.get("limitations") or []),
            )
        )
    _ = ref
    return out
