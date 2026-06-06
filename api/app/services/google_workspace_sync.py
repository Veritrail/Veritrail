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

DIRECTORY_API = "https://admin.googleapis.com/admin/directory/v1"
ADMIN_ROLE_IDS = {
    "_SEED_ADMIN_ROLE",
    "_SUPER_ADMIN_ROLE",
}


@dataclass
class GoogleWorkspaceSyncStats:
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


def _paginate_users(client: httpx.Client, domain: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    page_token: str | None = None
    while True:
        params: dict[str, Any] = {
            "domain": domain,
            "customer": "my_customer",
            "maxResults": 500,
            "orderBy": "email",
            "projection": "full",
        }
        if page_token:
            params["pageToken"] = page_token
        resp = client.get(f"{DIRECTORY_API}/users", params=params)
        if resp.status_code in (403, 404):
            return rows
        resp.raise_for_status()
        data = resp.json()
        rows.extend(data.get("users") or [])
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return rows


def _paginate_role_assignments(client: httpx.Client) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    page_token: str | None = None
    while True:
        params: dict[str, Any] = {"customer": "my_customer", "maxResults": 200}
        if page_token:
            params["pageToken"] = page_token
        resp = client.get(f"{DIRECTORY_API}/customer/my_customer/roleassignments", params=params)
        if resp.status_code in (403, 404):
            return rows
        resp.raise_for_status()
        data = resp.json()
        rows.extend(data.get("items") or [])
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return rows


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
    suspended = bool(user.get("suspended"))
    row.email = user.get("primaryEmail")
    row.name = user.get("name", {}).get("fullName") if isinstance(user.get("name"), dict) else user.get("primaryEmail")
    row.mfa_enabled = bool(user.get("isEnrolledIn2Sv"))
    row.status = "inactive" if suspended else "active"
    row.roles_json = {
        "email": user.get("primaryEmail"),
        "is_admin": bool(admin_roles),
        "admin_roles": admin_roles,
        "is_enforced_in_2sv": bool(user.get("isEnforcedIn2Sv")),
        "org_unit_path": user.get("orgUnitPath"),
    }
    row.last_active_at = _parse_dt(user.get("lastLoginTime"))
    row.snapshot_taken_at = now


def sync_google_workspace_provider(
    db: Session,
    provider: IdentityProvider,
    domain: str | None = None,
) -> GoogleWorkspaceSyncStats:
    from app.services.google_workspace_tokens import GoogleWorkspaceReconnectRequired, ensure_google_workspace_token

    config = provider_config(provider)
    try:
        token = ensure_google_workspace_token(db, provider)
    except GoogleWorkspaceReconnectRequired:
        raise

    sync_domain = (domain or config.get("domain") or "").strip()
    if not sync_domain:
        raise ValueError("Google Workspace domain is required")

    now = datetime.now(timezone.utc)
    stats = GoogleWorkspaceSyncStats()
    admin_by_user: dict[str, list[str]] = {}

    with httpx.Client(headers=_headers(token), timeout=30) as client:
        for assignment in _paginate_role_assignments(client):
            role_id = assignment.get("roleId", "")
            assigned_to = assignment.get("assignedTo", "")
            if role_id in ADMIN_ROLE_IDS or "ADMIN" in role_id.upper():
                admin_by_user.setdefault(assigned_to, []).append(role_id)

        users = _paginate_users(client, sync_domain)
        enforced_count = 0
        for user in users:
            roles = admin_by_user.get(user["id"], [])
            _upsert_identity_user(db, provider.id, user, admin_roles=roles, now=now)
            stats.identity_users += 1
            if roles:
                stats.admin_users += 1
            if user.get("isEnforcedIn2Sv"):
                enforced_count += 1

        active_users = [u for u in users if not u.get("suspended")]
        config["domain"] = sync_domain
        config["two_step_verification_enforced"] = bool(active_users) and enforced_count == len(active_users)
        config["admin_user_count"] = stats.admin_users

    set_provider_config(provider, config)
    provider.status = "connected"
    provider.last_synced_at = now
    db.commit()
    return stats
