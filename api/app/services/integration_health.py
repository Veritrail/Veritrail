"""Lightweight connection health checks for org integrations."""
from __future__ import annotations

import uuid

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.aws_account import AwsAccount
from app.models.github import IdentityProvider
from app.services.entra_tokens import EntraReconnectRequired, ensure_entra_token
from app.services.github_sync import provider_config as github_provider_config
from app.services.gitlab_sync import provider_config as gitlab_provider_config
from app.services.gitlab_tokens import GitLabReconnectRequired, ensure_gitlab_token, refresh_gitlab_token_on_unauthorized
from app.services.google_workspace_tokens import GoogleWorkspaceReconnectRequired, ensure_google_workspace_token
from app.services.jira_client import JiraClient

log = structlog.get_logger()


def _gitlab_api_base(config: dict) -> str:
    base = (config.get("base_url") or "https://gitlab.com").rstrip("/")
    return f"{base}/api/v4"


def check_gitlab_health(db: Session, provider: IdentityProvider) -> str:
    try:
        token = ensure_gitlab_token(db, provider)
        config = gitlab_provider_config(provider)
        api = _gitlab_api_base(config)
        with httpx.Client(timeout=15) as client:
            resp = client.get(f"{api}/user", headers={"Authorization": f"Bearer {token}"})
            if resp.status_code == 401:
                token = refresh_gitlab_token_on_unauthorized(db, provider)
                resp = client.get(f"{api}/user", headers={"Authorization": f"Bearer {token}"})
            resp.raise_for_status()
        provider.status = "connected"
        return "connected"
    except GitLabReconnectRequired:
        provider.status = "error"
        return "error"
    except httpx.HTTPError:
        provider.status = "error"
        return "error"


def check_github_health(db: Session, provider: IdentityProvider) -> str:
    """Auth-only health check via ``/user``.

    Does **not** call security endpoints and must not be treated as evidence freshness.
    Evidence health is derived separately from stored capability sync records.
    """
    config = github_provider_config(provider)
    token = config.get("access_token")
    if not token:
        provider.status = "error"
        return "error"
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                "https://api.github.com/user",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/vnd.github+json",
                },
            )
            if resp.status_code == 401:
                provider.status = "error"
                return "error"
            resp.raise_for_status()
        provider.status = "connected"
        return "connected"
    except httpx.HTTPError:
        provider.status = "error"
        return "error"


def check_google_workspace_health(db: Session, provider: IdentityProvider) -> str:
    try:
        token = ensure_google_workspace_token(db, provider)
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                "https://admin.googleapis.com/admin/directory/v1/users",
                params={"maxResults": 1, "customer": "my_customer"},
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code == 401:
                provider.status = "error"
                return "error"
            resp.raise_for_status()
        provider.status = "connected"
        return "connected"
    except GoogleWorkspaceReconnectRequired:
        provider.status = "error"
        return "error"
    except httpx.HTTPError:
        provider.status = "error"
        return "error"


def check_entra_health(db: Session, provider: IdentityProvider) -> str:
    try:
        token = ensure_entra_token(db, provider)
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                "https://graph.microsoft.com/v1.0/organization",
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code == 401:
                provider.status = "error"
                return "error"
            resp.raise_for_status()
        provider.status = "connected"
        return "connected"
    except EntraReconnectRequired:
        provider.status = "error"
        return "error"
    except httpx.HTTPError:
        provider.status = "error"
        return "error"


def check_jira_health(db: Session, provider: IdentityProvider) -> str:
    cfg = github_provider_config(provider)
    site_url = cfg.get("site_url")
    email = cfg.get("email")
    api_token = cfg.get("api_token")
    if not all([site_url, email, api_token]):
        provider.status = "error"
        return "error"
    try:
        client = JiraClient(site_url=site_url, email=email, api_token=api_token)
        client.verify(cfg.get("project_key") or None)
        provider.status = "connected"
        return "connected"
    except Exception:  # noqa: BLE001
        provider.status = "error"
        return "error"


def check_org_integration_health(db: Session, org_id: uuid.UUID) -> dict[str, str]:
    """Ping connected integrations and refresh provider.status fields."""
    results: dict[str, str] = {}
    providers = db.scalars(
        select(IdentityProvider).where(IdentityProvider.org_id == org_id)
    ).all()

    for provider in providers:
        checker = {
            "gitlab": check_gitlab_health,
            "github": check_github_health,
            "google_workspace": check_google_workspace_health,
            "entra_id": check_entra_health,
            "jira": check_jira_health,
        }.get(provider.type)
        if not checker:
            continue
        try:
            results[provider.type] = checker(db, provider)
        except Exception:  # noqa: BLE001
            log.exception("integration.health_check_failed", provider_type=provider.type, org_id=str(org_id))
            provider.status = "error"
            results[provider.type] = "error"

    db.commit()
    return results


def check_org_integration_health_for_account(db: Session, account_id: uuid.UUID) -> dict[str, str] | None:
    acc = db.get(AwsAccount, account_id)
    if not acc:
        return None
    return check_org_integration_health(db, acc.org_id)
