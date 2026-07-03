"""Jamf Pro MDM integration routes."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.org_context import resolve_org
from app.core.route_deps import RequireAdmin
from app.core.security import current_principal
from app.models.github import IdentityProvider
from app.models.org import Org
from app.models.phase9 import MdmDeviceSnapshot
from app.services.jamf_sync import (
    JAMF_TYPE,
    provider_config,
    set_provider_config,
    sync_jamf_provider,
    verify_jamf_connection,
)

router = APIRouter()


def _get_org(p, db: Session) -> Org:
    return resolve_org(db, p)


def _provider(db: Session, org_id: uuid.UUID) -> IdentityProvider | None:
    return db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type == JAMF_TYPE,
        )
    )


class JamfProviderOut(BaseModel):
    connected: bool
    status: str
    base_url: str | None = None
    last_synced_at: str | None = None
    device_count: int = 0
    non_compliant_count: int = 0
    unencrypted_count: int = 0
    has_password: bool = False


class JamfIntegrationIn(BaseModel):
    base_url: str
    username: str
    password: str | None = None


@router.get("/jamf", response_model=JamfProviderOut)
def get_jamf(p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _provider(db, org.id)
    if not provider:
        return JamfProviderOut(connected=False, status="not_configured")
    cfg = provider_config(provider)
    devices = db.scalar(
        select(func.count()).select_from(MdmDeviceSnapshot).where(
            MdmDeviceSnapshot.provider_id == provider.id
        )
    ) or 0
    return JamfProviderOut(
        connected=True,
        status=provider.status,
        base_url=cfg.get("base_url"),
        last_synced_at=provider.last_synced_at.isoformat() if provider.last_synced_at else None,
        device_count=int(cfg.get("device_count") or devices),
        non_compliant_count=int(cfg.get("non_compliant_count") or 0),
        unencrypted_count=int(cfg.get("unencrypted_count") or 0),
        has_password=bool(cfg.get("password")),
    )


@router.put("/jamf", response_model=JamfProviderOut)
def put_jamf(body: JamfIntegrationIn, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _provider(db, org.id)
    if not provider:
        provider = IdentityProvider(
            id=uuid.uuid4(),
            org_id=org.id,
            type=JAMF_TYPE,
            config_json_encrypted="{}",
            status="pending",
            created_at=datetime.now(timezone.utc),
        )
        db.add(provider)
    cfg = provider_config(provider)
    cfg["base_url"] = body.base_url.strip()
    cfg["username"] = body.username.strip()
    if body.password:
        cfg["password"] = body.password
    verify_jamf_connection(cfg)
    set_provider_config(provider, cfg)
    provider.status = "connected"
    db.commit()
    return get_jamf(p=p, db=db)


@router.post("/jamf/sync")
def sync_jamf(_rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _provider(db, org.id)
    if not provider:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Jamf not configured")
    stats = sync_jamf_provider(db, provider)
    return {"ok": True, "devices": stats.devices, "unencrypted": stats.unencrypted}


@router.delete("/jamf", status_code=204)
def delete_jamf(_rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _provider(db, org.id)
    if provider:
        db.delete(provider)
        db.commit()
