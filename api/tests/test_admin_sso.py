"""Platform-admin Google SSO — one-time code handoff to the admin origin.

Flow under test:
  GET /v1/auth/google?origin=admin            → Google with state=admin-login
  GET /v1/auth/google/callback (state=admin-login)
      → {admin_url}/?sso_code=<one-time code>   (allowlisted user)
      → {admin_url}/?sso_error=not_admin        (anyone else; never provisions)
  POST /v1/auth/google/admin-exchange {code}  → session for the admin origin
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
import jwt

from app.core import admin_sso
from app.core.admin_sso import create_admin_sso_code
from app.core.config import get_settings
from app.core.db import get_db
from app.core.ratelimit import limiter
from app.models.org import Org, User
from app.routes import auth_oauth

ADMIN_DOMAIN = "admin.veritrail.test"
ADMIN_URL = f"https://{ADMIN_DOMAIN}"


class FakeRedis:
    """Just enough of redis for the one-time code store (setex/getdel)."""

    def __init__(self):
        self.store: dict[str, str] = {}

    def setex(self, key, ttl, value):
        self.store[key] = value

    def getdel(self, key):
        return self.store.pop(key, None)


@pytest.fixture(autouse=True)
def fake_redis(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(admin_sso, "_redis", lambda: fake)
    yield fake


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def client(db_session):
    from app.main import app

    def _db_override():
        yield db_session

    app.dependency_overrides[get_db] = _db_override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def users(db_session):
    suffix = uuid.uuid4().hex[:8]
    org = Org(id=uuid.uuid4(), name=f"Admin SSO Org {suffix}", slug=f"admin-sso-{suffix}")
    admin = User(
        id=uuid.uuid4(),
        org_id=org.id,
        email=f"ellie-{suffix}@cloud-castles.com",
        password_hash="x",
        role="owner",
        totp_enabled=True,
        totp_secret="JBSWY3DPEHPK3PXP",
    )
    regular = User(
        id=uuid.uuid4(),
        org_id=org.id,
        email=f"user-{suffix}@cloud-castles.com",
        password_hash="x",
        role="admin",
    )
    db_session.add_all([org, admin, regular])
    db_session.flush()
    return org, admin, regular


@pytest.fixture
def admin_env(monkeypatch, users):
    """ADMIN_DOMAIN + allowlist configured; settings cache cleared around the test."""
    _org, admin, _regular = users
    monkeypatch.setenv("ADMIN_DOMAIN", ADMIN_DOMAIN)
    monkeypatch.setenv("PLATFORM_ADMIN_EMAILS", admin.email)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _mock_google(monkeypatch, *, email: str, sub: str = "google-sub-1"):
    """Stub httpx so the callback's token exchange + userinfo fetch succeed."""

    def _resp(data):
        r = MagicMock()
        r.status_code = 200
        r.json.return_value = data
        return r

    http = MagicMock()
    http.__enter__ = MagicMock(return_value=http)
    http.__exit__ = MagicMock(return_value=False)
    http.post.return_value = _resp({"access_token": "google-access-token"})
    http.get.return_value = _resp({"email": email, "sub": sub, "name": "Ellie Admin"})
    monkeypatch.setattr(auth_oauth.httpx, "Client", lambda **_kw: http)


def _sso_code_from_location(location: str) -> str | None:
    parsed = urlparse(location)
    return (parse_qs(parsed.query).get("sso_code") or [None])[0]


# ── /v1/auth/google?origin=admin ──────────────────────────────────────────────


def test_google_login_admin_origin_uses_admin_state(client, admin_env, monkeypatch):
    monkeypatch.setattr(auth_oauth.settings, "GOOGLE_CLIENT_ID", "test-client-id")
    res = client.get("/v1/auth/google?origin=admin", follow_redirects=False)
    assert res.status_code in (302, 307)
    loc = res.headers["location"]
    assert loc.startswith("https://accounts.google.com/o/oauth2/v2/auth")
    assert parse_qs(urlparse(loc).query)["state"] == ["admin-login"]


def test_google_login_admin_origin_requires_admin_domain(client, monkeypatch):
    monkeypatch.setattr(auth_oauth.settings, "GOOGLE_CLIENT_ID", "test-client-id")
    monkeypatch.delenv("ADMIN_DOMAIN", raising=False)
    get_settings.cache_clear()
    try:
        res = client.get("/v1/auth/google?origin=admin", follow_redirects=False)
        assert res.status_code == 400
    finally:
        get_settings.cache_clear()


# ── callback with state=admin-login ──────────────────────────────────────────


def test_admin_callback_issues_one_time_code_for_allowlisted_admin(
    client, users, admin_env, monkeypatch, db_session
):
    _org, admin, _regular = users
    _mock_google(monkeypatch, email=admin.email)

    res = client.get(
        "/v1/auth/google/callback?code=x&state=admin-login", follow_redirects=False
    )
    assert res.status_code in (302, 307)
    loc = res.headers["location"]
    assert loc.startswith(f"{ADMIN_URL}/?sso_code=")
    code = _sso_code_from_location(loc)
    assert code

    # google_id gets attached to the matched account (same as app login flow)
    db_session.refresh(admin)
    assert admin.google_id == "google-sub-1"


def test_admin_callback_rejects_non_admin_without_provisioning(
    client, users, admin_env, monkeypatch, db_session
):
    _org, _admin, regular = users
    _mock_google(monkeypatch, email=regular.email, sub="google-sub-2")

    res = client.get(
        "/v1/auth/google/callback?code=x&state=admin-login", follow_redirects=False
    )
    assert res.headers["location"] == f"{ADMIN_URL}/?sso_error=not_admin"


def test_admin_callback_rejects_unknown_email_without_provisioning(
    client, users, admin_env, monkeypatch, db_session
):
    from sqlalchemy import func, select

    _mock_google(monkeypatch, email="stranger@example.com", sub="google-sub-3")
    before = db_session.scalar(select(func.count()).select_from(User))

    res = client.get(
        "/v1/auth/google/callback?code=x&state=admin-login", follow_redirects=False
    )
    assert res.headers["location"] == f"{ADMIN_URL}/?sso_error=not_admin"
    assert db_session.scalar(select(func.count()).select_from(User)) == before


def test_admin_callback_oauth_denied_redirects_to_admin_origin(client, admin_env):
    res = client.get(
        "/v1/auth/google/callback?error=access_denied&state=admin-login",
        follow_redirects=False,
    )
    assert res.headers["location"] == f"{ADMIN_URL}/?sso_error=oauth_denied"


# ── POST /v1/auth/google/admin-exchange ──────────────────────────────────────


def _callback_code(client, monkeypatch, email: str) -> str:
    _mock_google(monkeypatch, email=email)
    res = client.get(
        "/v1/auth/google/callback?code=x&state=admin-login", follow_redirects=False
    )
    return _sso_code_from_location(res.headers["location"])


def test_exchange_returns_session_and_code_is_single_use(
    client, users, admin_env, monkeypatch
):
    _org, admin, _regular = users
    code = _callback_code(client, monkeypatch, admin.email)

    res = client.post("/v1/auth/google/admin-exchange", json={"code": code})
    assert res.status_code == 200
    token = res.json()["access_token"]
    claims = jwt.decode(token, options={"verify_signature": False})
    assert claims["sub"] == str(admin.id)

    # replay is rejected
    res2 = client.post("/v1/auth/google/admin-exchange", json={"code": code})
    assert res2.status_code == 401


def test_exchange_rejects_garbage_code(client, admin_env):
    res = client.post("/v1/auth/google/admin-exchange", json={"code": "nonsense"})
    assert res.status_code == 401


def test_exchange_rechecks_allowlist(client, users, admin_env):
    """A minted code for a user who is not (or no longer) allowlisted is refused."""
    _org, _admin, regular = users
    code = create_admin_sso_code(str(regular.id))
    res = client.post("/v1/auth/google/admin-exchange", json={"code": code})
    assert res.status_code == 401


def test_exchange_session_passes_platform_admin_gate(
    client, users, admin_env, monkeypatch
):
    """Google SSO skips the TOTP challenge, but the enrolled admin's session
    fully works against the TOTP-gated platform-admin endpoints."""
    _org, admin, _regular = users
    code = _callback_code(client, monkeypatch, admin.email)
    token = client.post(
        "/v1/auth/google/admin-exchange", json={"code": code}
    ).json()["access_token"]

    res = client.get(
        "/v1/platform-admin/users", headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200
    assert any(u["email"] == admin.email for u in res.json())


def test_exchange_session_without_totp_enrollment_still_blocked_downstream(
    client, users, admin_env, monkeypatch, db_session
):
    """Decision on TOTP × SSO: Google SSO satisfies the *challenge* (Google 2FA),
    but TOTP enrollment remains mandatory for the dashboard endpoints."""
    _org, admin, _regular = users
    admin.totp_enabled = False
    admin.totp_secret = None
    db_session.flush()

    code = _callback_code(client, monkeypatch, admin.email)
    res = client.post("/v1/auth/google/admin-exchange", json={"code": code})
    assert res.status_code == 200  # session issued…
    token = res.json()["access_token"]

    gate = client.get(
        "/v1/platform-admin/users", headers={"Authorization": f"Bearer {token}"}
    )
    assert gate.status_code == 403  # …but the enrollment gate still holds
