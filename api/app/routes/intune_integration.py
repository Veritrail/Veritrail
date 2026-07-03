"""Intune MDM integration routes."""
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
from app.services.intune_sync import (
    INTUNE_TYPE,
    provider_config,
    set_provider_config,
    sync_intune_provider,
    verify_intune_connection,
)

router = APIRouter()


def _get_org(p, db: Session) -> Org:
    return resolve_org(db, p)


def _provider(db: Session, org_id: uuid.UUID) -> IdentityProvider | None:
    return db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type == INTUNE_TYPE,
        )
    )


class IntuneProviderOut(BaseModel):
    connected: bool
    status: str
    tenant_id: str | None = None
    last_synced_at: str | None = None
    device_count: int = 0
    non_compliant_count: int = 0
    unencrypted_count: int = 0
    has_access_token: bool = False


class IntuneIntegrationIn(BaseModel):
    tenant_id: str
    access_token: str | None = None


@router.get("/intune", response_model=IntuneProviderOut)
def get_intune(p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _provider(db, org.id)
    if not provider:
        return IntuneProviderOut(connected=False, status="not_configured")
    cfg = provider_config(provider)
    devices = db.scalar(
        select(func.count()).select_from(MdmDeviceSnapshot).where(
            MdmDeviceSnapshot.provider_id == provider.id
        )
    ) or 0
    return IntuneProviderOut(
        connected=True,
        status=provider.status,
        tenant_id=cfg.get("tenant_id"),
        last_synced_at=provider.last_synced_at.isoformat() if provider.last_synced_at else None,
        device_count=int(cfg.get("device_count") or devices),
        non_compliant_count=int(cfg.get("non_compliant_count") or 0),
        unencrypted_count=int(cfg.get("unencrypted_count") or 0),
        has_access_token=bool(cfg.get("access_token")),
    )


@router.put("/intune", response_model=IntuneProviderOut)
def put_intune(body: IntuneIntegrationIn, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _provider(db, org.id)
    if not provider:
        provider = IdentityProvider(
            id=uuid.uuid4(),
            org_id=org.id,
            type=INTUNE_TYPE,
            config_json_encrypted="{}",
            status="pending",
            created_at=datetime.now(timezone.utc),
        )
        db.add(provider)
    cfg = provider_config(provider)
    cfg["tenant_id"] = body.tenant_id.strip()
    if body.access_token:
        cfg["access_token"] = body.access_token.strip()
    verify_intune_connection(cfg)
    set_provider_config(provider, cfg)
    provider.status = "connected"
    db.commit()
    return get_intune(p=p, db=db)


@router.post("/intune/sync")
def sync_intune(_rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _provider(db, org.id)
    if not provider:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Intune not configured")
    stats = sync_intune_provider(db, provider)
    return {"ok": True, "devices": stats.devices, "non_compliant": stats.non_compliant}


@router.delete("/intune", status_code=204)
def delete_intune(_rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _provider(db, org.id)
    if provider:
        db.delete(provider)
        db.commit()
