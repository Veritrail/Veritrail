from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.github import IdentityProvider, IdentityUser

GRAPH_API = "https://graph.microsoft.com/v1.0"
PRIVILEGED_ROLE_TEMPLATE_IDS = {
    "62e90394-69f5-4237-9190-012177145e10",  # Global Administrator
    "194ae4cb-b126-40b2-bd5b-6091b133977d",  # Security Administrator
    "fe930be7-5e62-47db-91fc-62617917d814",  # Privileged Role Administrator
}


@dataclass
class EntraSyncStats:
    identity_users: int = 0
    admin_users: int = 0


def provider_config(provider: IdentityProvider) -> dict[str, Any]:
    try:
        return json.loads(provider.config_json_encrypted or "{}")
    except json.JSONDecodeError:
        return {}


def set_provider_config(provider: IdentityProvider, config: dict[str, Any]) -> None:
    provider.config_json_encrypted = json.dumps(config, separators=(",", ":"))


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _paginate(client: httpx.Client, url: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    next_url: str | None = url
    while next_url:
        resp = client.get(next_url)
        if resp.status_code in (403, 404):
            return rows
        resp.raise_for_status()
        data = resp.json()
        rows.extend(data.get("value") or [])
        next_url = data.get("@odata.nextLink")
    return rows


def _collect_directory_roles(client: httpx.Client) -> dict[str, list[str]]:
    role_by_member: dict[str, list[str]] = {}
    roles = {r["id"]: r.get("displayName", r["id"]) for r in _paginate(client, f"{GRAPH_API}/directoryRoles")}
    for role_id, role_name in roles.items():
        members = _paginate(client, f"{GRAPH_API}/directoryRoles/{role_id}/members")
        for member in members:
            mid = member.get("id")
            if mid:
                role_by_member.setdefault(mid, []).append(role_name)
    return role_by_member


def _upsert_identity_user(
    db: Session,
    provider_id: uuid.UUID,
    user: dict[str, Any],
    *,
    admin_roles: list[str],
    now: datetime,
) -> None:
    external_id = user["id"]
    row = db.scalar(
        select(IdentityUser).where(
            IdentityUser.provider_id == provider_id,
            IdentityUser.external_id == external_id,
        )
    )
    if not row:
        row = IdentityUser(id=uuid.uuid4(), provider_id=provider_id, external_id=external_id)
        db.add(row)
    enabled = bool(user.get("accountEnabled", True))
    row.email = user.get("mail") or user.get("userPrincipalName")
    row.name = user.get("displayName") or row.email
    row.mfa_enabled = None  # per-user MFA requires auth methods API; org check uses security defaults
    row.status = "active" if enabled else "inactive"
    row.roles_json = {
        "user_principal_name": user.get("userPrincipalName"),
        "is_admin": bool(admin_roles),
        "admin_roles": admin_roles,
    }
    row.last_active_at = _parse_dt(user.get("signInActivity", {}).get("lastSignInDateTime"))
    row.snapshot_taken_at = now


def sync_entra_provider(
    db: Session,
    provider: IdentityProvider,
    tenant_id: str | None = None,
) -> EntraSyncStats:
    from app.services.entra_tokens import EntraReconnectRequired, ensure_entra_token

    config = provider_config(provider)
    try:
        token = ensure_entra_token(db, provider)
    except EntraReconnectRequired:
        raise

    sync_tenant = (tenant_id or config.get("tenant_id") or "").strip()
    if not sync_tenant:
        raise ValueError("Microsoft Entra tenant ID is required")

    now = datetime.now(timezone.utc)
    stats = EntraSyncStats()

    with httpx.Client(headers=_headers(token), timeout=30) as client:
        org_resp = client.get(f"{GRAPH_API}/organization")
        security_defaults_enabled = False
        if org_resp.status_code == 200:
            orgs = org_resp.json().get("value") or []
            if orgs:
                security_defaults_enabled = bool(
                    orgs[0].get("securityComplianceNotificationMails") is not None
                    or orgs[0].get("onPremisesSyncEnabled") is not None
                )
                # Best-effort: read security defaults policy when available
                sd_resp = client.get(f"{GRAPH_API}/policies/identitySecurityDefaultsEnforcementPolicy")
                if sd_resp.status_code == 200:
                    security_defaults_enabled = bool(sd_resp.json().get("isEnabled"))

        role_by_member = _collect_directory_roles(client)
        users = _paginate(
            client,
            f"{GRAPH_API}/users?$select=id,displayName,mail,userPrincipalName,accountEnabled,signInActivity&$top=999",
        )
        for user in users:
            roles = role_by_member.get(user["id"], [])
            _upsert_identity_user(db, provider.id, user, admin_roles=roles, now=now)
            stats.identity_users += 1
            if roles:
                stats.admin_users += 1

        config["tenant_id"] = sync_tenant
        config["security_defaults_enabled"] = security_defaults_enabled
        config["admin_user_count"] = stats.admin_users

    set_provider_config(provider, config)
    provider.status = "connected"
    provider.last_synced_at = now
    db.commit()
    return stats
