"""Okta identity provider integration routes."""
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
from app.models.github import IdentityProvider, IdentityUser
from app.models.org import Org
from app.services.okta_sync import (
    provider_config,
    set_provider_config,
    sync_okta_provider,
    verify_okta_connection,
)
from app.services.integration_input import normalize_okta_org_url

router = APIRouter()
OKTA_TYPE = "okta"


def _get_org(p, db: Session) -> Org:
    return resolve_org(db, p)


def _provider(db: Session, org_id: uuid.UUID) -> IdentityProvider | None:
    return db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type == OKTA_TYPE,
        )
    )


class OktaProviderOut(BaseModel):
    connected: bool
    status: str
    org_url: str | None = None
    last_synced_at: str | None = None
    identity_users: int = 0
    admin_users: int = 0
    mfa_policy_enforced: bool | None = None
    has_api_token: bool = False


class OktaIntegrationIn(BaseModel):
    org_url: str
    api_token: str | None = None


@router.get("/okta", response_model=OktaProviderOut)
def get_okta(p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _provider(db, org.id)
    if not provider:
        return OktaProviderOut(connected=False, status="not_configured")
    cfg = provider_config(provider)
    identity_users = db.scalar(
        select(func.count()).select_from(IdentityUser).where(IdentityUser.provider_id == provider.id)
    ) or 0
    return OktaProviderOut(
        connected=True,
        status=provider.status,
        org_url=cfg.get("org_url"),
        last_synced_at=provider.last_synced_at.isoformat() if provider.last_synced_at else None,
        identity_users=identity_users,
        admin_users=int(cfg.get("admin_user_count") or 0),
        mfa_policy_enforced=cfg.get("mfa_policy_enforced"),
        has_api_token=bool(cfg.get("api_token")),
    )


@router.put("/okta", response_model=OktaProviderOut)
def put_okta(body: OktaIntegrationIn, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _provider(db, org.id)
    existing = provider_config(provider) if provider else {}
    api_token = (body.api_token or "").strip() or existing.get("api_token")
    if not api_token:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Okta API token is required")
    config = {
        **existing,
        "org_url": normalize_okta_org_url(body.org_url.strip()),
        "api_token": api_token,
    }
    try:
        verify_okta_connection(config)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Okta verify failed: {e}") from e

    if not provider:
        provider = IdentityProvider(org_id=org.id, type=OKTA_TYPE, status="connected")
        db.add(provider)
    set_provider_config(provider, config)
    provider.status = "connected"
    provider.last_synced_at = datetime.now(timezone.utc)
    db.flush()

    from app.services.integration_sync_scan import run_integration_checks

    run_integration_checks(db, org.id, OKTA_TYPE)
    db.commit()
    db.refresh(provider)
    return get_okta(p=p, db=db)


@router.post("/okta/test")
def test_okta(
    _rbac: RequireAdmin,
    body: OktaIntegrationIn | None = None,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    provider = _provider(db, org.id)
    cfg = dict(provider_config(provider) if provider else {})
    if body:
        if body.org_url.strip():
            cfg["org_url"] = normalize_okta_org_url(body.org_url.strip())
        if body.api_token and body.api_token.strip():
            cfg["api_token"] = body.api_token.strip()
    try:
        return verify_okta_connection(cfg)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Okta test failed: {e}") from e


@router.post("/okta/sync")
def sync_okta(_rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _provider(db, org.id)
    if not provider or provider.status != "connected":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Okta is not connected")
    try:
        stats = sync_okta_provider(db, provider)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Okta sync failed: {e}") from e

    return {"ok": True, "identity_users": stats.identity_users, "admin_users": stats.admin_users}


@router.delete("/okta", status_code=204)
def delete_okta(_rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _provider(db, org.id)
    if provider:
        db.delete(provider)
        db.commit()
