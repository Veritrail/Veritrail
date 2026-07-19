"""SIEM integration routes (Splunk, Datadog, Elastic)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.org_context import resolve_org
from app.core.route_deps import RequireAdmin
from app.core.security import current_principal
from app.models.github import IdentityProvider
from app.models.org import Org
from app.services.github_sync import provider_config, set_provider_config
from app.services.siem_integrations import (
    public_config,
    siem_type_for_vendor,
    sync_summary,
    verify_siem_connection,
)
from app.services.integration_input import normalize_api_base_url, normalize_datadog_site

router = APIRouter()
SUPPORTED_VENDORS = ("splunk", "datadog", "elastic")


def _get_org(p, db: Session) -> Org:
    return resolve_org(db, p)


def _vendor(vendor: str) -> str:
    key = (vendor or "").strip().lower()
    if key not in SUPPORTED_VENDORS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unsupported SIEM vendor: {vendor}")
    return key


def _provider(db: Session, org_id: uuid.UUID, vendor: str) -> IdentityProvider | None:
    return db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type == siem_type_for_vendor(vendor),
        )
    )


class SiemIntegrationOut(BaseModel):
    connected: bool
    status: str
    vendor: str
    config: dict


class SiemIntegrationIn(BaseModel):
    base_url: str | None = None
    cluster_url: str | None = None
    site: str | None = None
    index: str | None = None
    api_token: str | None = None
    api_key: str | None = None
    app_key: str | None = None


@router.get("/siem/{vendor}", response_model=SiemIntegrationOut)
def get_siem(vendor: str, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    key = _vendor(vendor)
    provider = _provider(db, org.id, key)
    if not provider:
        return SiemIntegrationOut(connected=False, status="not_configured", vendor=key, config={})
    cfg = provider_config(provider)
    return SiemIntegrationOut(
        connected=True,
        status=provider.status,
        vendor=key,
        config=public_config(key, cfg),
    )


@router.put("/siem/{vendor}", response_model=SiemIntegrationOut)
def put_siem(
    vendor: str,
    body: SiemIntegrationIn,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    key = _vendor(vendor)
    provider = _provider(db, org.id, key)
    existing = provider_config(provider) if provider else {}
    config = dict(existing)

    if key == "splunk":
        if body.base_url:
            config["base_url"] = normalize_api_base_url(body.base_url.strip())
        if body.index:
            config["index"] = body.index.strip()
        if body.api_token:
            config["api_token"] = body.api_token.strip()
        if not all([config.get("base_url"), config.get("api_token")]):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Splunk requires base_url and api_token")
    elif key == "datadog":
        if body.site:
            config["site"] = normalize_datadog_site(body.site.strip())
        if body.api_key:
            config["api_key"] = body.api_key.strip()
        if body.app_key:
            config["app_key"] = body.app_key.strip()
        if not all([config.get("api_key"), config.get("app_key")]):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Datadog requires api_key and app_key")
    elif key == "elastic":
        if body.cluster_url:
            config["cluster_url"] = normalize_api_base_url(body.cluster_url.strip())
        if body.api_key:
            config["api_key"] = body.api_key.strip()
        if not all([config.get("cluster_url"), config.get("api_key")]):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Elastic requires cluster_url and api_key")

    try:
        verify_siem_connection(key, config)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"SIEM verify failed: {e}") from e

    if not provider:
        provider = IdentityProvider(org_id=org.id, type=siem_type_for_vendor(key), status="connected")
        db.add(provider)
    set_provider_config(provider, config)
    provider.status = "connected"
    provider.last_synced_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(provider)
    return get_siem(vendor=key, p=p, db=db)


@router.post("/siem/{vendor}/sync")
def sync_siem(
    vendor: str,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    key = _vendor(vendor)
    provider = _provider(db, org.id, key)
    if not provider or provider.status != "connected":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{key} SIEM is not connected")
    cfg = provider_config(provider)
    try:
        summary = sync_summary(key, cfg)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"SIEM sync failed: {e}") from e
    cfg.update(summary)
    set_provider_config(provider, cfg)
    provider.last_synced_at = datetime.fromisoformat(summary["last_synced_at"])
    db.commit()
    public = {k: v for k, v in summary.items() if k != "capability_evidence"}
    return {"ok": True, **public}


@router.delete("/siem/{vendor}", status_code=204)
def delete_siem(
    vendor: str,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    key = _vendor(vendor)
    provider = _provider(db, org.id, key)
    if provider:
        db.delete(provider)
        db.commit()
