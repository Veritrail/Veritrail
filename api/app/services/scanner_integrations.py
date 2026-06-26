"""Vulnerability scanner API integrations (Wiz, Tenable, Qualys)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

SCANNER_TYPES = {
    "wiz": "scanner_wiz",
    "tenable": "scanner_tenable",
    "qualys": "scanner_qualys",
}

VENDOR_LABELS = {
    "wiz": "Wiz",
    "tenable": "Tenable",
    "qualys": "Qualys",
}


def scanner_type_for_vendor(vendor: str) -> str:
    key = (vendor or "").strip().lower()
    if key not in SCANNER_TYPES:
        raise ValueError(f"Unsupported scanner vendor: {vendor}")
    return SCANNER_TYPES[key]


def public_config(vendor: str, cfg: dict[str, Any]) -> dict[str, Any]:
    key = vendor.lower()
    base = {
        "vendor": key,
        "label": VENDOR_LABELS.get(key, key),
        "last_synced_at": cfg.get("last_synced_at"),
        "open_findings_count": cfg.get("open_findings_count"),
    }
    if key == "wiz":
        base.update(
            {
                "api_url": cfg.get("api_url"),
                "has_client_id": bool(cfg.get("client_id")),
                "has_client_secret": bool(cfg.get("client_secret")),
            }
        )
    elif key == "tenable":
        base.update(
            {
                "api_url": cfg.get("api_url") or "https://cloud.tenable.com",
                "has_access_key": bool(cfg.get("access_key")),
                "has_secret_key": bool(cfg.get("secret_key")),
            }
        )
    elif key == "qualys":
        base.update(
            {
                "platform_url": cfg.get("platform_url"),
                "username": cfg.get("username"),
                "has_password": bool(cfg.get("password")),
            }
        )
    return base


def verify_scanner_connection(vendor: str, cfg: dict[str, Any]) -> dict[str, Any]:
    key = vendor.lower()
    if key == "wiz":
        return _test_wiz(cfg)
    if key == "tenable":
        return _test_tenable(cfg)
    if key == "qualys":
        return _test_qualys(cfg)
    raise ValueError(f"Unsupported scanner vendor: {vendor}")


def sync_summary(vendor: str, cfg: dict[str, Any]) -> dict[str, Any]:
    key = vendor.lower()
    if key == "wiz":
        count = _wiz_open_findings(cfg)
    elif key == "tenable":
        count = _tenable_open_findings(cfg)
    elif key == "qualys":
        count = _qualys_open_findings(cfg)
    else:
        raise ValueError(f"Unsupported scanner vendor: {vendor}")

    now = datetime.now(timezone.utc).isoformat()
    return {
        "open_findings_count": count,
        "last_synced_at": now,
    }


def _test_wiz(cfg: dict[str, Any]) -> dict[str, Any]:
    api_url = (cfg.get("api_url") or "").rstrip("/")
    client_id = cfg.get("client_id")
    client_secret = cfg.get("client_secret")
    if not all([api_url, client_id, client_secret]):
        raise ValueError("Wiz requires api_url, client_id, and client_secret")
    token = _wiz_token(api_url, client_id, client_secret)
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(
            f"{api_url}/graphql",
            headers={"Authorization": f"Bearer {token}"},
            json={"query": "query { currentUser { id email } }"},
        )
    if resp.status_code >= 400:
        raise ValueError(f"Wiz API error {resp.status_code}")
    return {"ok": True, "vendor": "wiz"}


def _wiz_token(api_url: str, client_id: str, client_secret: str) -> str:
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(
            f"{api_url}/oauth/token",
            data={
                "grant_type": "client_credentials",
                "audience": "wiz-api",
                "client_id": client_id,
                "client_secret": client_secret,
            },
        )
    if resp.status_code >= 400:
        raise ValueError("Wiz OAuth failed")
    token = resp.json().get("access_token")
    if not token:
        raise ValueError("Wiz OAuth response missing access_token")
    return token


def _wiz_open_findings(cfg: dict[str, Any]) -> int:
    api_url = (cfg.get("api_url") or "").rstrip("/")
    token = _wiz_token(api_url, cfg["client_id"], cfg["client_secret"])
    query = """
    query { issuesV2(filterBy: {status: [OPEN]}) { totalCount } }
    """
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(
            f"{api_url}/graphql",
            headers={"Authorization": f"Bearer {token}"},
            json={"query": query},
        )
    if resp.status_code >= 400:
        raise ValueError(f"Wiz sync error {resp.status_code}")
    data = resp.json().get("data") or {}
    issues = data.get("issuesV2") or {}
    return int(issues.get("totalCount") or 0)


def _test_tenable(cfg: dict[str, Any]) -> dict[str, Any]:
    api_url = (cfg.get("api_url") or "https://cloud.tenable.com").rstrip("/")
    access_key = cfg.get("access_key")
    secret_key = cfg.get("secret_key")
    if not all([access_key, secret_key]):
        raise ValueError("Tenable requires access_key and secret_key")
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(
            f"{api_url}/workbenches/assets",
            headers={"X-ApiKeys": f"accessKey={access_key}; secretKey={secret_key}"},
            params={"limit": 1},
        )
    if resp.status_code >= 400:
        raise ValueError(f"Tenable API error {resp.status_code}")
    return {"ok": True, "vendor": "tenable"}


def _tenable_open_findings(cfg: dict[str, Any]) -> int:
    api_url = (cfg.get("api_url") or "https://cloud.tenable.com").rstrip("/")
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(
            f"{api_url}/workbenches/vulnerabilities",
            headers={
                "X-ApiKeys": f"accessKey={cfg['access_key']}; secretKey={cfg['secret_key']}"
            },
            params={"date_range": 30, "filter.0.quality": "eq", "filter.0.filter": "severity", "filter.0.value": "high"},
        )
    if resp.status_code >= 400:
        raise ValueError(f"Tenable sync error {resp.status_code}")
    rows = resp.json() or []
    return len(rows) if isinstance(rows, list) else int(resp.json().get("total") or 0)


def _test_qualys(cfg: dict[str, Any]) -> dict[str, Any]:
    platform_url = (cfg.get("platform_url") or "").rstrip("/")
    username = cfg.get("username")
    password = cfg.get("password")
    if not all([platform_url, username, password]):
        raise ValueError("Qualys requires platform_url, username, and password")
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(
            f"{platform_url}/api/2.0/fo/asset/host/",
            params={"action": "list", "truncation_limit": 1},
            auth=(username, password),
            headers={"X-Requested-With": "Veritrail"},
        )
    if resp.status_code >= 400:
        raise ValueError(f"Qualys API error {resp.status_code}")
    return {"ok": True, "vendor": "qualys"}


def _qualys_open_findings(cfg: dict[str, Any]) -> int:
    platform_url = (cfg.get("platform_url") or "").rstrip("/")
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(
            f"{platform_url}/api/2.0/fo/knowledge_base/vuln/",
            params={"action": "list", "details": "None", "truncation_limit": 1},
            auth=(cfg["username"], cfg["password"]),
            headers={"X-Requested-With": "Veritrail"},
        )
    if resp.status_code >= 400:
        raise ValueError(f"Qualys sync error {resp.status_code}")
    text = resp.text or ""
    if "RECORDS" in text.upper():
        for line in text.splitlines():
            if line.strip().upper().startswith("<RECORDS>"):
                try:
                    return int(line.split(">", 1)[1].split("<", 1)[0])
                except ValueError:
                    break
    return 0
