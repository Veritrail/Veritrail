"""Okta directory sync for identity governance evidence."""
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

from app.services.integration_input import api_access_error, normalize_okta_org_url

OKTA_ADMIN_ROLES = frozenset({
    "SUPER_ADMIN",
    "ORG_ADMIN",
    "APP_ADMIN",
    "GROUP_MEMBERSHIP_ADMIN",
    "USER_ADMIN",
})


@dataclass
class OktaSyncStats:
    identity_users: int = 0
    admin_users: int = 0


def provider_config(provider: IdentityProvider) -> dict[str, Any]:
    try:
        return json.loads(provider.config_json_encrypted or "{}")
    except json.JSONDecodeError:
        return {}


def set_provider_config(provider: IdentityProvider, config: dict[str, Any]) -> None:
    provider.config_json_encrypted = json.dumps(config, separators=(",", ":"))


def _org_url(raw: str) -> str:
    return normalize_okta_org_url(raw)


def _headers(api_token: str) -> dict[str, str]:
    token = api_token.strip()
    if not token:
        raise ValueError("Okta API token is required")
    return {"Authorization": f"SSWS {token}", "Accept": "application/json"}


def _paginate(client: httpx.Client, path: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    url: str | None = path
    while url:
        resp = client.get(url)
        if resp.status_code in (403, 404):
            return rows
        resp.raise_for_status()
        rows.extend(resp.json() if isinstance(resp.json(), list) else [])
        url = None
        link = resp.headers.get("Link") or ""
        for part in link.split(","):
            if 'rel="next"' in part:
                url = part.split(";")[0].strip().strip("<>")
                break
    return rows


def verify_okta_connection(cfg: dict[str, Any]) -> dict[str, Any]:
    org_url = _org_url(cfg.get("org_url") or "")
    with httpx.Client(timeout=30.0, headers=_headers(cfg["api_token"])) as client:
        resp = client.get(f"{org_url}/api/v1/org")
    if resp.status_code >= 400:
        raise ValueError(api_access_error("Okta", resp.status_code, hint="Check org URL and API token."))
    return {"ok": True, "vendor": "okta", "org": (resp.json() or {}).get("companyName")}


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


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
    profile = user.get("profile") or {}
    status = (user.get("status") or "").upper()
    row.email = profile.get("email") or profile.get("login")
    row.name = profile.get("displayName") or profile.get("login") or row.email
    row.mfa_enabled = None
    row.status = "active" if status == "ACTIVE" else "inactive"
    row.roles_json = {
        "login": profile.get("login"),
        "is_admin": bool(admin_roles),
        "admin_roles": admin_roles,
    }
    row.last_active_at = _parse_dt(user.get("lastLogin"))
    row.snapshot_taken_at = now


def _mfa_policy_enforced(client: httpx.Client, org_url: str) -> bool:
    policies = _paginate(client, f"{org_url}/api/v1/policies?type=OKTA_SIGN_ON")
    for policy in policies:
        if not policy.get("status") == "ACTIVE":
            continue
        rules_resp = client.get(f"{org_url}/api/v1/policies/{policy['id']}/rules")
        if rules_resp.status_code >= 400:
            continue
        for rule in rules_resp.json() if isinstance(rules_resp.json(), list) else []:
            actions = (rule.get("actions") or {}).get("signon") or {}
            if actions.get("requireFactor") or actions.get("factorPromptMode") == "ALWAYS":
                return True
    return False


def sync_okta_provider(db: Session, provider: IdentityProvider) -> OktaSyncStats:
    config = provider_config(provider)
    org_url = _org_url(config.get("org_url") or "")
    api_token = config.get("api_token") or ""
    now = datetime.now(timezone.utc)
    stats = OktaSyncStats()

    with httpx.Client(timeout=60.0, headers=_headers(api_token)) as client:
        mfa_enforced = _mfa_policy_enforced(client, org_url)
        users = _paginate(client, f"{org_url}/api/v1/users?filter=status eq \"ACTIVE\"")
        for user in users:
            user_id = user.get("id")
            admin_roles: list[str] = []
            if user_id:
                roles_resp = client.get(f"{org_url}/api/v1/users/{user_id}/roles")
                if roles_resp.status_code == 200:
                    for role in roles_resp.json() if isinstance(roles_resp.json(), list) else []:
                        rtype = (role.get("type") or "").upper()
                        if rtype in OKTA_ADMIN_ROLES:
                            admin_roles.append(role.get("label") or rtype)
            _upsert_identity_user(db, provider.id, user, admin_roles=admin_roles, now=now)
            stats.identity_users += 1
            if admin_roles:
                stats.admin_users += 1

        config["mfa_policy_enforced"] = mfa_enforced
        config["admin_user_count"] = stats.admin_users

    set_provider_config(provider, config)
    provider.status = "connected"
    provider.last_synced_at = now
    db.commit()
    return stats
