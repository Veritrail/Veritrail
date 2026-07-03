"""GitHub App installation helpers for least-privilege repository access."""
from __future__ import annotations

import time
from typing import Any

import httpx
from jose import jwt

from app.core.config import get_settings

GITHUB_API = "https://api.github.com"
GITHUB_WEB = "https://github.com"
GITHUB_API_VERSION = "2022-11-28"


def _settings():
    return get_settings()


def github_app_configured() -> bool:
    s = _settings()
    return bool(s.GITHUB_APP_ID and s.GITHUB_APP_SLUG and s.GITHUB_APP_PRIVATE_KEY)


def _private_key() -> str:
    key = _settings().GITHUB_APP_PRIVATE_KEY.strip()
    if "\\n" in key:
        key = key.replace("\\n", "\n")
    return key


def github_app_jwt() -> str:
    s = _settings()
    if not github_app_configured():
        raise ValueError("GitHub App is not configured")
    now = int(time.time())
    payload = {
        "iat": now - 60,
        "exp": now + 540,
        "iss": str(s.GITHUB_APP_ID),
    }
    return jwt.encode(payload, _private_key(), algorithm="RS256")


def app_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {github_app_jwt()}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
    }


def installation_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
    }


def installation_url(state: str) -> str:
    slug = _settings().GITHUB_APP_SLUG.strip()
    if not slug or not github_app_configured():
        raise ValueError("GitHub App is not configured")
    return f"{GITHUB_WEB}/apps/{slug}/installations/new?state={state}"


def get_installation(installation_id: int) -> dict[str, Any]:
    with httpx.Client(headers=app_headers(), timeout=20) as client:
        resp = client.get(f"{GITHUB_API}/app/installations/{installation_id}")
        resp.raise_for_status()
        return resp.json()


def create_installation_token(
    installation_id: int,
    *,
    repository_ids: list[int] | None = None,
    permissions: dict[str, str] | None = None,
) -> str:
    body: dict[str, Any] = {}
    if repository_ids:
        body["repository_ids"] = repository_ids
    if permissions:
        body["permissions"] = permissions
    with httpx.Client(headers=app_headers(), timeout=20) as client:
        resp = client.post(f"{GITHUB_API}/app/installations/{installation_id}/access_tokens", json=body)
        resp.raise_for_status()
        token = resp.json().get("token")
        if not token:
            raise ValueError("GitHub did not return an installation token")
        return token


def paginate_installation_repositories(installation_id: int) -> list[dict[str, Any]]:
    token = create_installation_token(installation_id, permissions={"metadata": "read", "contents": "read"})
    rows: list[dict[str, Any]] = []
    next_url = f"{GITHUB_API}/installation/repositories"
    params: dict[str, Any] | None = {"per_page": 100}
    with httpx.Client(headers=installation_headers(token), timeout=30) as client:
        while next_url:
            resp = client.get(next_url, params=params)
            resp.raise_for_status()
            data = resp.json()
            rows.extend(data.get("repositories") or [])
            next_url = resp.links.get("next", {}).get("url")
            params = None
    return rows
