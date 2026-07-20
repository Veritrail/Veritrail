"""CrowdStrike and SentinelOne EDR integration routes (Phase 4)."""
from __future__ import annotations

import uuid
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
from app.services.edr_integrations import (
    DEFAULT_CROWDSTRIKE_BASE,
    CROWDSTRIKE_REGION_PRESETS,
    EDR_LABELS,
    crowdstrike_region_for_base_url,
    edr_type_for_vendor,
    public_config,
    sync_summary,
    validate_sentinelone_management_url,
    verify_edr_connection,
)
from app.services.github_sync import provider_config, set_provider_config
from app.services.integration_input import normalize_api_base_url

router = APIRouter()
SUPPORTED_VENDORS = ("crowdstrike", "sentinelone")


def _vendor(vendor: str) -> str:
    key = (vendor or "").strip().lower()
    if key not in SUPPORTED_VENDORS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unsupported EDR vendor: {vendor}")
    return key


def _provider(db: Session, org_id: uuid.UUID, vendor: str) -> IdentityProvider | None:
    return db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type == edr_type_for_vendor(vendor),
        )
    )


class EdrIntegrationOut(BaseModel):
    connected: bool
    status: str
    vendor: str
    config: dict


class EdrIntegrationIn(BaseModel):
    base_url: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    management_url: str | None = None
    api_token: str | None = None


class EdrGaValidatedIn(BaseModel):
    ga_validated: bool


@router.get("/edr/{vendor}", response_model=EdrIntegrationOut)
def get_edr(vendor: str, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = resolve_org(db, p)
    key = _vendor(vendor)
    provider = _provider(db, org.id, key)
    if not provider:
        empty: dict = {
            "vendor": key,
            "label": EDR_LABELS.get(key, key),
            "beta": True,
            "ga_validated": False,
        }
        if key == "crowdstrike":
            empty.update(
                {
                    "base_url": DEFAULT_CROWDSTRIKE_BASE,
                    "region": crowdstrike_region_for_base_url(DEFAULT_CROWDSTRIKE_BASE),
                    "region_presets": list(CROWDSTRIKE_REGION_PRESETS),
                    "has_client_id": False,
                    "has_client_secret": False,
                }
            )
        return EdrIntegrationOut(connected=False, status="not_configured", vendor=key, config=empty)
    return EdrIntegrationOut(
        connected=True,
        status=provider.status,
        vendor=key,
        config=public_config(key, provider_config(provider)),
    )


@router.put("/edr/{vendor}", response_model=EdrIntegrationOut)
def put_edr(
    vendor: str,
    body: EdrIntegrationIn,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = resolve_org(db, p)
    key = _vendor(vendor)
    provider = _provider(db, org.id, key)
    config = dict(provider_config(provider)) if provider else {}

    if key == "crowdstrike":
        if body.base_url:
            config["base_url"] = normalize_api_base_url(body.base_url.strip())
        if body.client_id:
            config["client_id"] = body.client_id.strip()
        if body.client_secret:
            config["client_secret"] = body.client_secret.strip()
        if not all([config.get("client_id"), config.get("client_secret")]):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "CrowdStrike requires client_id and client_secret",
            )
    else:
        if body.management_url:
            try:
                config["management_url"] = validate_sentinelone_management_url(body.management_url)
            except ValueError as exc:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
        if body.api_token:
            config["api_token"] = body.api_token.strip()
        if not all([config.get("management_url"), config.get("api_token")]):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "SentinelOne requires management_url and api_token",
            )
        # Re-validate stored URL even when only the token is rotated.
        try:
            config["management_url"] = validate_sentinelone_management_url(
                str(config.get("management_url") or "")
            )
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    try:
        verify_edr_connection(key, config)
        summary = sync_summary(key, config)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"{key} verification failed: {exc}") from exc

    if not provider:
        provider = IdentityProvider(org_id=org.id, type=edr_type_for_vendor(key), status="connected")
        db.add(provider)
    config.update(summary)
    set_provider_config(provider, config)
    provider.status = "connected"
    provider.last_synced_at = datetime.fromisoformat(summary["last_synced_at"])
    db.commit()
    db.refresh(provider)
    return get_edr(vendor=key, p=p, db=db)


@router.put(
    "/edr/{vendor}/ga-validated",
    response_model=EdrIntegrationOut,
    summary="Mark EDR provider as GA-validated for grading",
    description=(
        "Set ga_validated=true only after the checklist in "
        "docs/edr-live-validation-record.md is satisfied for that provider. "
        "Connect/sync alone must never set this flag."
    ),
)
def put_edr_ga_validated(
    vendor: str,
    body: EdrGaValidatedIn,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Flip the live-validation grading gate for an EDR provider (admin only)."""
    org = resolve_org(db, p)
    key = _vendor(vendor)
    provider = _provider(db, org.id, key)
    if not provider:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{key} is not configured")
    config = dict(provider_config(provider))
    config["ga_validated"] = bool(body.ga_validated)
    set_provider_config(provider, config)
    db.commit()
    db.refresh(provider)
    return get_edr(vendor=key, p=p, db=db)


@router.post("/edr/{vendor}/sync")
def sync_edr(
    vendor: str,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = resolve_org(db, p)
    key = _vendor(vendor)
    provider = _provider(db, org.id, key)
    if not provider or provider.status != "connected":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{key} is not connected")
    config = dict(provider_config(provider))
    try:
        summary = sync_summary(key, config)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"{key} sync failed: {exc}") from exc
    config.update(summary)
    set_provider_config(provider, config)
    provider.last_synced_at = datetime.fromisoformat(summary["last_synced_at"])
    db.commit()
    return {"ok": True, **{k: v for k, v in summary.items() if k != "capability_evidence"}}


@router.delete("/edr/{vendor}", status_code=status.HTTP_204_NO_CONTENT)
def delete_edr(
    vendor: str,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = resolve_org(db, p)
    key = _vendor(vendor)
    provider = _provider(db, org.id, key)
    if provider:
        db.delete(provider)
        db.commit()
