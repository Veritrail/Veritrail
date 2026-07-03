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
GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
REQUIRED_DIRECTORY_SCOPES = (
    "https://www.googleapis.com/auth/admin.directory.user.readonly",
    "https://www.googleapis.com/auth/admin.directory.rolemanagement.readonly",
)
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


def _google_error_message(resp: httpx.Response) -> str:
    try:
        payload = resp.json()
        err = payload.get("error") or {}
        if isinstance(err, dict):
            message = err.get("message") or err.get("status")
            if message:
                return str(message)
        if isinstance(err, str):
            return err
    except (json.JSONDecodeError, ValueError):
        pass
    text = (resp.text or "").strip()
    return text[:500] if text else f"HTTP {resp.status_code}"


def _raise_directory_error(resp: httpx.Response) -> None:
    detail = _google_error_message(resp)
    if resp.status_code == 403:
        if "insufficient" in detail.lower():
            raise ValueError(
                "Google Workspace access token lacks Admin Directory scopes. "
                "Disconnect and reconnect with a Workspace super-admin account. "
                "Enable Admin SDK API in Google Cloud and ensure your OAuth client requests "
                "admin.directory.user.readonly and admin.directory.rolemanagement.readonly."
            )
        raise ValueError(
            "Google Workspace Admin Directory API denied access "
            f"({detail}). Connect with a Workspace super-admin account and enable Admin SDK API "
            "in the Google Cloud project that owns your OAuth client."
        )
    resp.raise_for_status()


def assert_admin_directory_scopes(token: str) -> None:
    with httpx.Client(timeout=10) as client:
        resp = client.get(GOOGLE_TOKENINFO_URL, params={"access_token": token})
    if resp.status_code != 200:
        return
    granted = set((resp.json().get("scope") or "").split())
    missing = [scope for scope in REQUIRED_DIRECTORY_SCOPES if scope not in granted]
    if missing:
        short = ", ".join(scope.rsplit("/", 1)[-1] for scope in missing)
        raise ValueError(
            "Google Workspace access token lacks Admin Directory scopes "
            f"({short}). Disconnect and reconnect with a Workspace super-admin account."
        )


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
        if not resp.is_success:
            _raise_directory_error(resp)
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
        if not resp.is_success:
            _raise_directory_error(resp)
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

    assert_admin_directory_scopes(token)

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
