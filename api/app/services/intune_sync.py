"""Microsoft Intune MDM device sync via Microsoft Graph."""
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

INTUNE_TYPE = "intune"


@dataclass
class IntuneSyncStats:
    devices: int = 0
    non_compliant: int = 0
    unencrypted: int = 0


def provider_config(provider: IdentityProvider) -> dict[str, Any]:
    try:
        return json.loads(provider.config_json_encrypted or "{}")
    except json.JSONDecodeError:
        return {}


def set_provider_config(provider: IdentityProvider, config: dict[str, Any]) -> None:
    provider.config_json_encrypted = json.dumps(config, separators=(",", ":"))


def verify_intune_connection(cfg: dict[str, Any]) -> dict[str, Any]:
    tenant_id = (cfg.get("tenant_id") or "").strip()
    token = (cfg.get("access_token") or "").strip()
    if not tenant_id or not token:
        raise ValueError("tenant_id and access_token are required")
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(
            "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$top=1",
            headers={"Authorization": f"Bearer {token}"},
        )
    if resp.status_code >= 400:
        raise ValueError(f"Intune Graph API error {resp.status_code}")
    return {"ok": True, "vendor": "intune", "tenant_id": tenant_id}


def _paginate_devices(client: httpx.Client, token: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    url: str | None = "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$top=100"
    headers = {"Authorization": f"Bearer {token}"}
    while url:
        resp = client.get(url, headers=headers)
        if resp.status_code >= 400:
            break
        body = resp.json()
        rows.extend(body.get("value") or [])
        url = body.get("@odata.nextLink")
    return rows


def sync_intune_provider(db: Session, provider: IdentityProvider) -> IntuneSyncStats:
    cfg = provider_config(provider)
    token = cfg.get("access_token") or ""
    now = datetime.now(timezone.utc)
    stats = IntuneSyncStats()

    db.execute(delete(MdmDeviceSnapshot).where(MdmDeviceSnapshot.provider_id == provider.id))

    with httpx.Client(timeout=60.0) as client:
        for device in _paginate_devices(client, token):
            ext_id = device.get("id")
            if not ext_id:
                continue
            encrypted = device.get("isEncrypted")
            compliant = (device.get("complianceState") or "").lower() == "compliant"
            row = MdmDeviceSnapshot(
                id=uuid.uuid4(),
                provider_id=provider.id,
                external_id=ext_id,
                device_name=device.get("deviceName"),
                platform=device.get("operatingSystem"),
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
    cfg["non_compliant_count"] = stats.non_compliant
    cfg["unencrypted_count"] = stats.unencrypted
    set_provider_config(provider, cfg)
    provider.status = "connected"
    provider.last_synced_at = now
    db.commit()
    return stats
