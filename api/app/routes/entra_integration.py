from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import current_principal
from app.models.github import IdentityProvider, IdentityUser
from app.services.entra_sync import provider_config, set_provider_config, sync_entra_provider
from app.services.entra_tokens import EntraReconnectRequired, apply_oauth_tokens

router = APIRouter()
settings = get_settings()

ENTRA_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
ENTRA_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
ENTRA_SCOPES = "offline_access User.Read Directory.Read.All RoleManagement.Read.Directory"


class EntraProviderOut(BaseModel):
    id: str
    status: str
    tenant_id: str | None
    admin_email: str | None
    last_synced_at: str | None
    identity_users: int
    admin_users: int
    security_defaults_enabled: bool | None


class EntraSyncIn(BaseModel):
    tenant_id: str | None = None


class EntraSyncOut(BaseModel):
    identity_users: int
    admin_users: int


class EntraScopeIn(BaseModel):
    tenant_id: str


class EntraScopeOut(BaseModel):
    tenant_id: str | None


class ConnectUrlOut(BaseModel):
    url: str


def _frontend_url() -> str:
    return settings.FRONTEND_URL


def _callback_uri() -> str:
    path_or_url = settings.ENTRA_INTEGRATION_CALLBACK_PATH
    if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
        return path_or_url
    return f"{settings.API_PUBLIC_URL}{path_or_url}"


def _issue_state(user_id: str, org_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "type": "entra_integration",
        "sub": user_id,
        "org_id": org_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=10)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALG)


def _decode_state(state: str) -> dict:
    try:
        payload = jwt.decode(state, settings.JWT_SECRET, algorithms=[settings.JWT_ALG])
    except JWTError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"bad state: {e}") from e
    if payload.get("type") != "entra_integration":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad state type")
    return payload


def _provider_for_org(db: Session, org_id: str) -> IdentityProvider | None:
    return db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == uuid.UUID(org_id),
            IdentityProvider.type == "entra_id",
        )
    )


def _provider_out(db: Session, provider: IdentityProvider) -> EntraProviderOut:
    config = provider_config(provider)
    identity_users = db.scalar(
        select(func.count()).select_from(IdentityUser).where(IdentityUser.provider_id == provider.id)
    ) or 0
    return EntraProviderOut(
        id=str(provider.id),
        status=provider.status,
        tenant_id=config.get("tenant_id"),
        admin_email=config.get("admin_email"),
        last_synced_at=provider.last_synced_at.isoformat() if provider.last_synced_at else None,
        identity_users=identity_users,
        admin_users=int(config.get("admin_user_count") or 0),
        security_defaults_enabled=config.get("security_defaults_enabled"),
    )


def _connect_url(p: dict) -> str:
    if not settings.ENTRA_CLIENT_ID:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Microsoft Entra OAuth not configured")
    state = _issue_state(p["sub"], p["org_id"])
    params = {
        "client_id": settings.ENTRA_CLIENT_ID,
        "redirect_uri": _callback_uri(),
        "response_type": "code",
        "scope": ENTRA_SCOPES,
        "state": state,
        "prompt": "consent",
    }
    return f"{ENTRA_AUTH_URL}?{urlencode(params)}"


@router.get("/entra/connect-url", response_model=ConnectUrlOut)
def entra_connect_url(p=Depends(current_principal)):
    return ConnectUrlOut(url=_connect_url(p))


@router.get("/entra/callback")
def entra_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    if error or not code or not state:
        return RedirectResponse(f"{_frontend_url()}/integrations/entra?error=oauth_denied")
    try:
        payload = _decode_state(state)
        org_id = payload["org_id"]
        existing = _provider_for_org(db, org_id)

        with httpx.Client(timeout=15) as client:
            token_resp = client.post(
                ENTRA_TOKEN_URL,
                data={
                    "client_id": settings.ENTRA_CLIENT_ID,
                    "client_secret": settings.ENTRA_CLIENT_SECRET,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": _callback_uri(),
                    "scope": ENTRA_SCOPES,
                },
                headers={"Accept": "application/json"},
            )
            if token_resp.status_code != 200:
                return RedirectResponse(f"{_frontend_url()}/integrations/entra?error=oauth_failed")
            token_data = token_resp.json()
            access_token = token_data.get("access_token")
            if not access_token:
                return RedirectResponse(f"{_frontend_url()}/integrations/entra?error=oauth_failed")

            me_resp = client.get(
                "https://graph.microsoft.com/v1.0/me",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            me_resp.raise_for_status()
            profile = me_resp.json()

            org_resp = client.get(
                "https://graph.microsoft.com/v1.0/organization",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            tenant_id = None
            if org_resp.status_code == 200:
                orgs = org_resp.json().get("value") or []
                if orgs:
                    tenant_id = orgs[0].get("id")

        provider = existing
        if not provider:
            provider = IdentityProvider(
                id=uuid.uuid4(),
                org_id=uuid.UUID(org_id),
                type="entra_id",
                config_json_encrypted="{}",
            )
            db.add(provider)
        set_provider_config(
            provider,
            apply_oauth_tokens(
                {
                    **provider_config(provider),
                    "admin_email": profile.get("mail") or profile.get("userPrincipalName"),
                    "entra_user_id": profile.get("id"),
                    "tenant_id": tenant_id,
                },
                token_data,
            ),
        )
        provider.status = "connected"
        db.commit()
        return RedirectResponse(f"{_frontend_url()}/integrations/entra?connected=1")
    except Exception:
        db.rollback()
        return RedirectResponse(f"{_frontend_url()}/integrations/entra?error=server_error")


@router.get("/entra", response_model=EntraProviderOut | None)
def get_entra_provider(p=Depends(current_principal), db: Session = Depends(get_db)):
    provider = _provider_for_org(db, p["org_id"])
    if not provider:
        return None
    return _provider_out(db, provider)


@router.put("/entra/scope", response_model=EntraScopeOut)
def update_entra_scope(body: EntraScopeIn, p=Depends(current_principal), db: Session = Depends(get_db)):
    provider = _provider_for_org(db, p["org_id"])
    if not provider:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Microsoft Entra ID is not connected")
    tenant_id = body.tenant_id.strip()
    if not tenant_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Entra tenant ID is required")
    config = provider_config(provider)
    config["tenant_id"] = tenant_id
    set_provider_config(provider, config)
    db.commit()
    return EntraScopeOut(tenant_id=tenant_id)


@router.post("/entra/sync", response_model=EntraSyncOut)
def sync_entra(body: EntraSyncIn, p=Depends(current_principal), db: Session = Depends(get_db)):
    provider = _provider_for_org(db, p["org_id"])
    if not provider:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Microsoft Entra ID is not connected")
    try:
        stats = sync_entra_provider(db, provider, body.tenant_id)
    except EntraReconnectRequired as e:
        provider.status = "error"
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except httpx.HTTPStatusError as e:
        provider.status = "error"
        db.commit()
        detail = e.response.text[:500] if e.response is not None else str(e)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Entra sync failed: {detail}") from e
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    return EntraSyncOut(**stats.__dict__)


@router.delete("/entra", status_code=status.HTTP_204_NO_CONTENT)
def disconnect_entra(p=Depends(current_principal), db: Session = Depends(get_db)):
    provider = _provider_for_org(db, p["org_id"])
    if provider:
        db.delete(provider)
        db.commit()
