"""Jamf Pro MDM device sync."""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.github import IdentityProvider
from app.models.phase9 import MdmDeviceSnapshot

JAMF_TYPE = "jamf"


@dataclass
class JamfSyncStats:
    devices: int = 0
    unencrypted: int = 0
    non_compliant: int = 0


def provider_config(provider: IdentityProvider) -> dict[str, Any]:
    try:
        return json.loads(provider.config_json_encrypted or "{}")
    except json.JSONDecodeError:
        return {}


def set_provider_config(provider: IdentityProvider, config: dict[str, Any]) -> None:
    provider.config_json_encrypted = json.dumps(config, separators=(",", ":"))


def _base_url(cfg: dict[str, Any]) -> str:
    url = (cfg.get("base_url") or "").strip().rstrip("/")
    if not url.startswith("http"):
        url = f"https://{url}"
    return url


def verify_jamf_connection(cfg: dict[str, Any]) -> dict[str, Any]:
    base = _base_url(cfg)
    user = (cfg.get("username") or "").strip()
    password = (cfg.get("password") or "").strip()
    if not user or not password:
        raise ValueError("username and password are required")
    with httpx.Client(timeout=30.0, auth=(user, password)) as client:
        resp = client.get(f"{base}/api/v1/auth")
    if resp.status_code >= 400:
        raise ValueError(f"Jamf API error {resp.status_code}")
    return {"ok": True, "vendor": "jamf"}


def _fetch_computers(client: httpx.Client, base: str) -> list[dict[str, Any]]:
    resp = client.get(f"{base}/JSSResource/computers")
    if resp.status_code >= 400:
        return []
    # Jamf classic API returns XML; for mock-friendly JSON path use inventory endpoint when available
    try:
        inv = client.get(f"{base}/api/v1/computers-inventory", params={"page-size": 200})
        if inv.status_code == 200:
            body = inv.json()
            return body.get("results") or []
    except Exception:
        pass
    return []


def _device_encrypted(device: dict[str, Any]) -> bool | None:
    general = device.get("general") or device
    storage = device.get("storage") or {}
    if "filevault2_active" in general:
        return bool(general.get("filevault2_active"))
    if "fileVault2Enabled" in device:
        return bool(device.get("fileVault2Enabled"))
    if isinstance(storage, dict) and "fileVault2Enabled" in storage:
        return bool(storage.get("fileVault2Enabled"))
    return None


def sync_jamf_provider(db: Session, provider: IdentityProvider) -> JamfSyncStats:
    cfg = provider_config(provider)
    base = _base_url(cfg)
    user = cfg.get("username") or ""
    password = cfg.get("password") or ""
    now = datetime.now(timezone.utc)
    stats = JamfSyncStats()

    db.execute(delete(MdmDeviceSnapshot).where(MdmDeviceSnapshot.provider_id == provider.id))

    with httpx.Client(timeout=60.0, auth=(user, password)) as client:
        for device in _fetch_computers(client, base):
            general = device.get("general") or device
            ext_id = str(general.get("id") or general.get("udid") or device.get("id") or "")
            if not ext_id:
                continue
            encrypted = _device_encrypted(device)
            compliant = encrypted is not False
            row = MdmDeviceSnapshot(
                id=uuid.uuid4(),
                provider_id=provider.id,
                external_id=ext_id,
                device_name=general.get("name") or general.get("computer_name"),
                platform=general.get("platform") or "macOS",
                encrypted=encrypted,
                compliant=compliant,
                last_sync_at=now,
            )
            db.add(row)
            stats.devices += 1
            if encrypted is False:
                stats.unencrypted += 1
            if not compliant:
                stats.non_compliant += 1

    cfg["device_count"] = stats.devices
    cfg["unencrypted_count"] = stats.unencrypted
    cfg["non_compliant_count"] = stats.non_compliant
    set_provider_config(provider, cfg)
    provider.status = "connected"
    provider.last_synced_at = now
    db.flush()

    from app.services.integration_sync_scan import run_integration_checks

    run_integration_checks(db, provider.org_id, JAMF_TYPE)
    db.commit()
    return stats
