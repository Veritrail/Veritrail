"""Okta directory sync for identity governance evidence."""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote

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


_BROAD_SCOPE_HINTS = ("admin", "manage", "write", "delete", "full")


def _collect_risky_app_grants(client: httpx.Client, org_url: str) -> list[dict[str, Any]]:
    risky: list[dict[str, Any]] = []
    apps = _paginate(client, f"{org_url}/api/v1/apps")
    for app in apps[:50]:
        app_id = app.get("id")
        if not app_id:
            continue
        grants_resp = client.get(f"{org_url}/api/v1/apps/{app_id}/grants")
        if grants_resp.status_code >= 400:
            continue
        scopes: list[str] = []
        for grant in grants_resp.json() if isinstance(grants_resp.json(), list) else []:
            for scope in grant.get("scope") or []:
                scopes.append(str(scope))
        if any(any(h in s.lower() for h in _BROAD_SCOPE_HINTS) for s in scopes):
            risky.append(
                {
                    "app_id": app_id,
                    "app_name": (app.get("label") or app.get("name")),
                    "scopes": scopes,
                }
            )
    return risky


def _collect_stale_api_tokens(client: httpx.Client, org_url: str) -> list[dict[str, Any]]:
    stale: list[dict[str, Any]] = []
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    resp = client.get(f"{org_url}/api/v1/api/tokens")
    if resp.status_code >= 400:
        return stale
    for token in resp.json() if isinstance(resp.json(), list) else []:
        updated = _parse_dt(token.get("lastUpdated"))
        if updated and updated < cutoff:
            stale.append(
                {
                    "id": token.get("id"),
                    "name": token.get("name"),
                    "last_updated": updated.isoformat(),
                }
            )
    return stale


def sync_okta_provider(db: Session, provider: IdentityProvider) -> OktaSyncStats:
    config = provider_config(provider)
    org_url = _org_url(config.get("org_url") or "")
    api_token = config.get("api_token") or ""
    now = datetime.now(timezone.utc)
    stats = OktaSyncStats()

    with httpx.Client(timeout=60.0, headers=_headers(api_token)) as client:
        mfa_enforced = _mfa_policy_enforced(client, org_url)
        # Okta 400s on literal double-quotes in the query; percent-encode the filter value.
        users = _paginate(client, f"{org_url}/api/v1/users?filter={quote('status eq \"ACTIVE\"')}")
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
        config["risky_app_grants"] = _collect_risky_app_grants(client, org_url)
        config["stale_api_tokens"] = _collect_stale_api_tokens(client, org_url)

    set_provider_config(provider, config)
    provider.status = "connected"
    provider.last_synced_at = now
    db.flush()

    from app.services.integration_sync_scan import run_integration_checks

    run_integration_checks(db, provider.org_id, "okta")
    db.commit()
    return stats
