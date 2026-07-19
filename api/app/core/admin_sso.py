"""One-time handoff codes for platform-admin Google SSO.

The Google OAuth callback lands on the API origin (api.veritrail.io), but the
admin SPA needs its own HttpOnly refresh cookie on the admin origin
(admin.veritrail.io). Instead of widening the cookie scope to .veritrail.io,
the callback issues a short-lived single-use code, redirects the browser to
the admin origin, and the SPA exchanges the code same-origin
(POST /v1/auth/google/admin-exchange) for its session.

Codes are stored hashed in Redis (shared across API workers) with a short TTL
and consumed atomically with GETDEL, so a code leaked via URL/access logs is
useless after first redemption.
"""
from __future__ import annotations

import hashlib
import secrets

import redis

from app.core.config import get_settings

CODE_TTL_SECONDS = 60

_client: redis.Redis | None = None


def _redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(get_settings().REDIS_URL, decode_responses=True)
    return _client


def _key(code: str) -> str:
    return "admin_sso:code:" + hashlib.sha256(code.encode()).hexdigest()


def create_admin_sso_code(user_id: str) -> str:
    code = secrets.token_urlsafe(32)
    _redis().setex(_key(code), CODE_TTL_SECONDS, user_id)
    return code


def consume_admin_sso_code(code: str) -> str | None:
    """Return the user id for a valid code, deleting it atomically (single use)."""
    if not code:
        return None
    return _redis().getdel(_key(code))
