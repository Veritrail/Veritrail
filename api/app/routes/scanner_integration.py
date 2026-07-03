"""Vulnerability scanner integration routes (Wiz, Tenable, Qualys)."""
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
from app.services.scanner_integrations import (
    public_config,
    scanner_type_for_vendor,
    verify_scanner_connection,
)
from app.services.scanner_sync import sync_scanner_provider
from app.services.integration_input import normalize_api_base_url, normalize_snyk_org_id

router = APIRouter()

SUPPORTED_VENDORS = ("wiz", "tenable", "qualys", "snyk", "orca", "aikido")


def _get_org(p, db: Session) -> Org:
    return resolve_org(db, p)


def _vendor(vendor: str) -> str:
    key = (vendor or "").strip().lower()
    if key not in SUPPORTED_VENDORS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unsupported scanner vendor: {vendor}")
    return key


def _provider(db: Session, org_id: uuid.UUID, vendor: str) -> IdentityProvider | None:
    return db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type == scanner_type_for_vendor(vendor),
        )
    )


class ScannerIntegrationOut(BaseModel):
    connected: bool
    status: str
    vendor: str
    config: dict


class ScannerIntegrationIn(BaseModel):
    api_url: str | None = None
    platform_url: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    access_key: str | None = None
    secret_key: str | None = None
    username: str | None = None
    password: str | None = None
    api_token: str | None = None
    org_id: str | None = None


@router.get("/scanners/{vendor}", response_model=ScannerIntegrationOut)
def get_scanner(vendor: str, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    key = _vendor(vendor)
    provider = _provider(db, org.id, key)
    if not provider:
        return ScannerIntegrationOut(connected=False, status="not_configured", vendor=key, config={})
    cfg = provider_config(provider)
    return ScannerIntegrationOut(
        connected=True,
        status=provider.status,
        vendor=key,
        config=public_config(key, cfg),
    )


@router.put("/scanners/{vendor}", response_model=ScannerIntegrationOut)
def put_scanner(
    vendor: str,
    body: ScannerIntegrationIn,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    key = _vendor(vendor)
    provider = _provider(db, org.id, key)
    existing = provider_config(provider) if provider else {}

    config = dict(existing)
    if key == "wiz":
        if body.api_url:
            config["api_url"] = normalize_api_base_url(body.api_url.strip())
        if body.client_id:
            config["client_id"] = body.client_id.strip()
        if body.client_secret:
            config["client_secret"] = body.client_secret.strip()
        if not all([config.get("api_url"), config.get("client_id"), config.get("client_secret")]):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Wiz requires api_url, client_id, and client_secret")
    elif key == "tenable":
        if body.api_url:
            config["api_url"] = normalize_api_base_url(body.api_url.strip())
        if body.access_key:
            config["access_key"] = body.access_key.strip()
        if body.secret_key:
            config["secret_key"] = body.secret_key.strip()
        if not all([config.get("access_key"), config.get("secret_key")]):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tenable requires access_key and secret_key")
    elif key == "qualys":
        if body.platform_url:
            config["platform_url"] = normalize_api_base_url(body.platform_url.strip())
        if body.username:
            config["username"] = body.username.strip()
        if body.password:
            config["password"] = body.password.strip()
        if not all([config.get("platform_url"), config.get("username"), config.get("password")]):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Qualys requires platform_url, username, and password")
    elif key in {"snyk", "orca", "aikido"}:
        if body.api_url:
            config["api_url"] = normalize_api_base_url(body.api_url.strip())
        if body.api_token:
            config["api_token"] = body.api_token.strip()
        if body.org_id:
            config["org_id"] = normalize_snyk_org_id(body.org_id.strip())
        if key == "snyk" and not all([config.get("org_id"), config.get("api_token")]):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Snyk requires org_id and api_token")
        if key in {"orca", "aikido"} and not config.get("api_token"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{key.title()} requires api_token")

    try:
        verify_scanner_connection(key, config)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Scanner verify failed: {e}") from e

    if not provider:
        provider = IdentityProvider(org_id=org.id, type=scanner_type_for_vendor(key), status="connected")
        db.add(provider)
    set_provider_config(provider, config)
    provider.status = "connected"
    provider.last_synced_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(provider)
    return get_scanner(vendor=key, p=p, db=db)


@router.post("/scanners/{vendor}/test")
def test_scanner(
    vendor: str,
    _rbac: RequireAdmin,
    body: ScannerIntegrationIn = ScannerIntegrationIn(),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    key = _vendor(vendor)
    provider = _provider(db, org.id, key)
    cfg = dict(provider_config(provider) if provider else {})
    for field, value in body.model_dump(exclude_none=True).items():
        if isinstance(value, str) and value.strip():
            cfg[field] = value.strip()
    try:
        return verify_scanner_connection(key, cfg)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Scanner test failed: {e}") from e


@router.post("/scanners/{vendor}/sync")
def sync_scanner(
    vendor: str,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    key = _vendor(vendor)
    provider = _provider(db, org.id, key)
    if not provider or provider.status != "connected":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{key} scanner is not connected")
    cfg = provider_config(provider)
    try:
        stats = sync_scanner_provider(db, provider, key, cfg)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Scanner sync failed: {e}") from e

    summary = {
        "open_findings_count": stats.open_findings_count,
        "last_synced_at": stats.last_synced_at,
        "imported": stats.imported,
        "opened": stats.opened,
        "resolved": stats.resolved,
    }
    cfg.update(summary)
    set_provider_config(provider, cfg)
    provider.last_synced_at = datetime.fromisoformat(stats.last_synced_at)
    db.commit()
    return {"ok": True, **summary}


@router.delete("/scanners/{vendor}", status_code=204)
def delete_scanner(
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
