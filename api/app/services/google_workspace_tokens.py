"""Google Workspace OAuth token refresh for the integrations connection."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.github import IdentityProvider
from app.services.google_workspace_sync import provider_config, set_provider_config

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
REFRESH_BUFFER_SECONDS = 120

RECONNECT_MESSAGE = (
    "Google Workspace authorization expired. Disconnect and connect again to restore access."
)


class GoogleWorkspaceReconnectRequired(Exception):
    def __str__(self) -> str:
        return RECONNECT_MESSAGE


def apply_oauth_tokens(config: dict[str, Any], token_json: dict[str, Any]) -> dict[str, Any]:
    out = {**config, "access_token": token_json["access_token"]}
    if token_json.get("refresh_token"):
        out["refresh_token"] = token_json["refresh_token"]
    expires_in = token_json.get("expires_in")
    if expires_in is not None:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
        out["token_expires_at"] = expires_at.isoformat()
    return out


def _token_expired(config: dict[str, Any], buffer_seconds: int = REFRESH_BUFFER_SECONDS) -> bool:
    raw = config.get("token_expires_at")
    if not raw:
        return bool(config.get("refresh_token"))
    try:
        expires = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return bool(config.get("refresh_token"))
    return datetime.now(timezone.utc) >= expires - timedelta(seconds=buffer_seconds)


def refresh_google_workspace_token(db: Session, provider: IdentityProvider) -> str:
    config = provider_config(provider)
    refresh = config.get("refresh_token")
    if not refresh:
        raise GoogleWorkspaceReconnectRequired()

    settings = get_settings()
    with httpx.Client(timeout=15) as client:
        resp = client.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": settings.effective_google_workspace_client_id,
                "client_secret": settings.effective_google_workspace_client_secret,
                "refresh_token": refresh,
                "grant_type": "refresh_token",
            },
            headers={"Accept": "application/json"},
        )
    if resp.status_code != 200:
        raise GoogleWorkspaceReconnectRequired()
    data = resp.json()
    if not data.get("access_token"):
        raise GoogleWorkspaceReconnectRequired()

    set_provider_config(provider, apply_oauth_tokens(config, data))
    db.commit()
    return provider_config(provider)["access_token"]


def ensure_google_workspace_token(db: Session, provider: IdentityProvider) -> str:
    config = provider_config(provider)
    token = config.get("access_token")
    if not token:
        raise GoogleWorkspaceReconnectRequired()
    if _token_expired(config):
        return refresh_google_workspace_token(db, provider)
    return token
