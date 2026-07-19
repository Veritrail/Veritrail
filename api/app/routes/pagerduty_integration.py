"""PagerDuty incident-workflow integration routes."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.org_context import resolve_org
from app.core.route_deps import RequireAdmin
from app.core.security import current_principal
from app.models.github import IdentityProvider
from app.services.github_sync import provider_config, set_provider_config
from app.services.pagerduty_integration import (
    PAGERDUTY_PROVIDER_TYPE,
    public_config,
    sync_summary,
    verify_connection,
)

router = APIRouter()


class PagerDutyIntegrationOut(BaseModel):
    connected: bool
    status: str
    vendor: str = "pagerduty"
    config: dict


class PagerDutyIntegrationIn(BaseModel):
    api_token: str | None = None


def _provider(db: Session, org_id):
    return db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type == PAGERDUTY_PROVIDER_TYPE,
        )
    )


@router.get("/pagerduty", response_model=PagerDutyIntegrationOut)
def get_pagerduty(p=Depends(current_principal), db: Session = Depends(get_db)):
    org = resolve_org(db, p)
    provider = _provider(db, org.id)
    if not provider:
        return PagerDutyIntegrationOut(connected=False, status="not_configured", config={})
    return PagerDutyIntegrationOut(
        connected=True,
        status=provider.status,
        config=public_config(provider_config(provider)),
    )


@router.put("/pagerduty", response_model=PagerDutyIntegrationOut)
def put_pagerduty(
    body: PagerDutyIntegrationIn,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = resolve_org(db, p)
    provider = _provider(db, org.id)
    config = dict(provider_config(provider)) if provider else {}
    if body.api_token:
        config["api_token"] = body.api_token.strip()
    if not config.get("api_token"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "PagerDuty requires an API access token")
    try:
        verify_connection(config)
        summary = sync_summary(config)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"PagerDuty verification failed: {exc}") from exc
    if not provider:
        provider = IdentityProvider(org_id=org.id, type=PAGERDUTY_PROVIDER_TYPE, status="connected")
        db.add(provider)
    config.update(summary)
    set_provider_config(provider, config)
    provider.status = "connected"
    provider.last_synced_at = datetime.fromisoformat(summary["last_synced_at"])
    db.commit()
    db.refresh(provider)
    return get_pagerduty(p=p, db=db)


@router.post("/pagerduty/sync")
def sync_pagerduty(
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = resolve_org(db, p)
    provider = _provider(db, org.id)
    if not provider or provider.status != "connected":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "PagerDuty is not connected")
    config = dict(provider_config(provider))
    try:
        summary = sync_summary(config)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"PagerDuty sync failed: {exc}") from exc
    config.update(summary)
    set_provider_config(provider, config)
    provider.last_synced_at = datetime.fromisoformat(summary["last_synced_at"])
    db.commit()
    return {"ok": True, **summary}


@router.delete("/pagerduty", status_code=status.HTTP_204_NO_CONTENT)
def delete_pagerduty(
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = resolve_org(db, p)
    provider = _provider(db, org.id)
    if provider:
        db.delete(provider)
        db.commit()
