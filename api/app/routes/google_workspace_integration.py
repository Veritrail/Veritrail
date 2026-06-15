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
from app.services.google_workspace_sync import provider_config, set_provider_config, sync_google_workspace_provider
from app.core.route_deps import RequireAdmin
from app.services.google_workspace_tokens import (
    GoogleWorkspaceReconnectRequired,
    apply_oauth_tokens,
    ensure_google_workspace_token,
)

router = APIRouter()
settings = get_settings()

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
WORKSPACE_SCOPES = " ".join([
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/admin.directory.user.readonly",
    "https://www.googleapis.com/auth/admin.directory.rolemanagement.readonly",
])


class GoogleWorkspaceProviderOut(BaseModel):
    id: str
    status: str
    admin_email: str | None
    domain: str | None
    last_synced_at: str | None
    identity_users: int
    admin_users: int
    two_step_verification_enforced: bool | None


class GoogleWorkspaceSyncIn(BaseModel):
    domain: str | None = None


class GoogleWorkspaceSyncOut(BaseModel):
    identity_users: int
    admin_users: int


class GoogleWorkspaceScopeIn(BaseModel):
    domain: str


class GoogleWorkspaceScopeOut(BaseModel):
    domain: str | None


class ConnectUrlOut(BaseModel):
    url: str


def _frontend_url() -> str:
    return settings.FRONTEND_URL


def _callback_uri() -> str:
    path_or_url = settings.GOOGLE_WORKSPACE_INTEGRATION_CALLBACK_PATH
    if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
        return path_or_url
    return f"{settings.API_PUBLIC_URL}{path_or_url}"


def _issue_state(user_id: str, org_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "type": "google_workspace_integration",
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
    if payload.get("type") != "google_workspace_integration":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad state type")
    return payload


def _provider_for_org(db: Session, org_id: str) -> IdentityProvider | None:
    return db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == uuid.UUID(org_id),
            IdentityProvider.type == "google_workspace",
        )
    )


def _provider_out(db: Session, provider: IdentityProvider) -> GoogleWorkspaceProviderOut:
    config = provider_config(provider)
    identity_users = db.scalar(
        select(func.count()).select_from(IdentityUser).where(IdentityUser.provider_id == provider.id)
    ) or 0
    admin_users = config.get("admin_user_count") or 0
    return GoogleWorkspaceProviderOut(
        id=str(provider.id),
        status=provider.status,
        admin_email=config.get("admin_email"),
        domain=config.get("domain"),
        last_synced_at=provider.last_synced_at.isoformat() if provider.last_synced_at else None,
        identity_users=identity_users,
        admin_users=int(admin_users),
        two_step_verification_enforced=config.get("two_step_verification_enforced"),
    )


def _connect_url(p: dict) -> str:
    if not settings.GOOGLE_WORKSPACE_CLIENT_ID:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Google Workspace OAuth not configured")
    state = _issue_state(p["sub"], p["org_id"])
    params = {
        "client_id": settings.GOOGLE_WORKSPACE_CLIENT_ID,
        "redirect_uri": _callback_uri(),
        "response_type": "code",
        "scope": WORKSPACE_SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


@router.get("/google-workspace/connect-url", response_model=ConnectUrlOut)
def google_workspace_connect_url(p=Depends(current_principal)):
    return ConnectUrlOut(url=_connect_url(p))


@router.get("/google-workspace/callback")
def google_workspace_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    if error or not code or not state:
        return RedirectResponse(f"{_frontend_url()}/integrations/google-workspace?error=oauth_denied")
    try:
        payload = _decode_state(state)
        org_id = payload["org_id"]
        existing = _provider_for_org(db, org_id)

        with httpx.Client(timeout=15) as client:
            token_resp = client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "client_id": settings.GOOGLE_WORKSPACE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_WORKSPACE_CLIENT_SECRET,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": _callback_uri(),
                },
                headers={"Accept": "application/json"},
            )
            if token_resp.status_code != 200:
                return RedirectResponse(f"{_frontend_url()}/integrations/google-workspace?error=oauth_failed")
            token_data = token_resp.json()
            access_token = token_data.get("access_token")
            if not access_token:
                return RedirectResponse(f"{_frontend_url()}/integrations/google-workspace?error=oauth_failed")

            user_resp = client.get(GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
            user_resp.raise_for_status()
            profile = user_resp.json()

        email = profile.get("email") or ""
        domain = email.split("@")[-1] if "@" in email else None
        provider = existing
        if not provider:
            provider = IdentityProvider(
                id=uuid.uuid4(),
                org_id=uuid.UUID(org_id),
                type="google_workspace",
                config_json_encrypted="{}",
            )
            db.add(provider)
        set_provider_config(
            provider,
            apply_oauth_tokens(
                {
                    **provider_config(provider),
                    "admin_email": email,
                    "domain": domain,
                    "google_user_id": profile.get("sub"),
                },
                token_data,
            ),
        )
        provider.status = "connected"
        db.commit()
        return RedirectResponse(f"{_frontend_url()}/integrations/google-workspace?connected=1")
    except Exception:
        db.rollback()
        return RedirectResponse(f"{_frontend_url()}/integrations/google-workspace?error=server_error")


@router.get("/google-workspace", response_model=GoogleWorkspaceProviderOut | None)
def get_google_workspace_provider(p=Depends(current_principal), db: Session = Depends(get_db)):
    provider = _provider_for_org(db, p["org_id"])
    if not provider:
        return None
    return _provider_out(db, provider)


@router.put("/google-workspace/scope", response_model=GoogleWorkspaceScopeOut)
def update_google_workspace_scope(body: GoogleWorkspaceScopeIn, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    provider = _provider_for_org(db, p["org_id"])
    if not provider:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Google Workspace is not connected")
    domain = body.domain.strip()
    if not domain or "." not in domain:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Valid Google Workspace domain is required")
    config = provider_config(provider)
    config["domain"] = domain
    set_provider_config(provider, config)
    db.commit()
    return GoogleWorkspaceScopeOut(domain=domain)


@router.post("/google-workspace/sync", response_model=GoogleWorkspaceSyncOut)
def sync_google_workspace(body: GoogleWorkspaceSyncIn, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    provider = _provider_for_org(db, p["org_id"])
    if not provider:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Google Workspace is not connected")
    try:
        stats = sync_google_workspace_provider(db, provider, body.domain)
    except GoogleWorkspaceReconnectRequired as e:
        provider.status = "error"
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except httpx.HTTPStatusError as e:
        provider.status = "error"
        db.commit()
        detail = e.response.text[:500] if e.response is not None else str(e)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Google Workspace sync failed: {detail}") from e
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    return GoogleWorkspaceSyncOut(**stats.__dict__)


@router.delete("/google-workspace", status_code=status.HTTP_204_NO_CONTENT)
def disconnect_google_workspace(_rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    provider = _provider_for_org(db, p["org_id"])
    if provider:
        db.delete(provider)
        db.commit()
