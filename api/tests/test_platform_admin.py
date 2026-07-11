"""Platform-admin dashboard endpoints — env-gated by PLATFORM_ADMIN_EMAILS."""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import get_db
from app.core.ratelimit import limiter
from app.core.security import issue_token
from app.models.access_request import AccessRequest
from app.models.org import Org, User
from app.models.platform_audit import PlatformAuditLog
from app.routes.platform_admin import MFA_REQUIRED_DETAIL


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


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """Platform-admin routes are rate limited per IP; TestClient is one IP."""
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def users(db_session):
    suffix = uuid.uuid4().hex[:8]
    org = Org(id=uuid.uuid4(), name=f"Admin Test Org {suffix}", slug=f"admin-test-{suffix}")
    # Platform admins must have TOTP enrolled — the fixture admin models the happy path.
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


def _auth(user: User) -> dict:
    return {"Authorization": f"Bearer {issue_token(str(user.id), str(user.org_id))}"}


def _with_admin_emails(monkeypatch, emails: str):
    monkeypatch.setenv("PLATFORM_ADMIN_EMAILS", emails)
    get_settings.cache_clear()


ENDPOINTS = ["/v1/platform-admin/users", "/v1/platform-admin/workspaces", "/v1/platform-admin/access-requests"]


@pytest.mark.parametrize("path", ENDPOINTS)
def test_unauthenticated_gets_401(client, path):
    assert client.get(path).status_code == 401


@pytest.mark.parametrize("path", ENDPOINTS)
def test_non_admin_gets_404(client, users, monkeypatch, path):
    _org, admin, regular = users
    _with_admin_emails(monkeypatch, admin.email)
    try:
        res = client.get(path, headers=_auth(regular))
        assert res.status_code == 404
    finally:
        get_settings.cache_clear()


@pytest.mark.parametrize("path", ENDPOINTS)
def test_empty_allowlist_blocks_everyone(client, users, monkeypatch, path):
    _org, admin, _regular = users
    _with_admin_emails(monkeypatch, "")
    try:
        res = client.get(path, headers=_auth(admin))
        assert res.status_code == 404
    finally:
        get_settings.cache_clear()


def test_admin_lists_users_and_workspaces(client, users, monkeypatch, db_session):
    org, admin, regular = users
    db_session.add(
        AccessRequest(name="Lead", email="lead@example.com", company="Prospect Co", mail_sent=True)
    )
    db_session.flush()
    _with_admin_emails(monkeypatch, f"other@cloud-castles.com, {admin.email.upper()}")
    try:
        users_res = client.get("/v1/platform-admin/users", headers=_auth(admin))
        assert users_res.status_code == 200
        emails = {u["email"] for u in users_res.json()}
        assert admin.email in emails and regular.email in emails
        row = next(u for u in users_res.json() if u["email"] == regular.email)
        assert row["org_name"] == org.name
        assert row["role"] == "admin"

        ws_res = client.get("/v1/platform-admin/workspaces", headers=_auth(admin))
        assert ws_res.status_code == 200
        ws = next(w for w in ws_res.json() if w["id"] == str(org.id))
        assert ws["user_count"] == 2
        assert ws["accounts_connected"] == 0
        assert ws["findings"] == 0

        ar_res = client.get("/v1/platform-admin/access-requests", headers=_auth(admin))
        assert ar_res.status_code == 200
        assert any(r["email"] == "lead@example.com" for r in ar_res.json())
    finally:
        get_settings.cache_clear()


def test_admin_without_totp_gets_403_enroll_mfa(client, users, monkeypatch, db_session):
    """An allowlisted admin who never enrolled TOTP cannot use the dashboard."""
    _org, admin, _regular = users
    admin.totp_enabled = False
    admin.totp_secret = None
    db_session.flush()
    _with_admin_emails(monkeypatch, admin.email)
    try:
        for path in ENDPOINTS:
            res = client.get(path, headers=_auth(admin))
            assert res.status_code == 403
            assert res.json()["detail"] == MFA_REQUIRED_DETAIL
    finally:
        get_settings.cache_clear()


def _audit_rows(db_session):
    return db_session.scalars(
        select(PlatformAuditLog).order_by(PlatformAuditLog.created_at)
    ).all()


def test_audit_rows_written_for_allowed_and_denied(client, users, monkeypatch, db_session):
    _org, admin, regular = users
    _with_admin_emails(monkeypatch, admin.email)
    try:
        assert client.get("/v1/platform-admin/users", headers=_auth(admin)).status_code == 200
        assert client.get("/v1/platform-admin/users", headers=_auth(regular)).status_code == 404

        rows = _audit_rows(db_session)
        allowed = [r for r in rows if r.allowed]
        denied = [r for r in rows if not r.allowed]
        assert len(allowed) == 1 and len(denied) == 1

        ok = allowed[0]
        assert ok.actor_user_id == admin.id
        assert ok.actor_email == admin.email
        assert ok.action == "platform_admin.access"
        assert ok.method == "GET"
        assert ok.endpoint == "/v1/platform-admin/users"
        assert ok.source_ip  # TestClient reports a client host
        assert ok.created_at is not None

        no = denied[0]
        assert no.actor_user_id == regular.id
        assert no.action == "platform_admin.denied"
        assert no.detail == {"reason": "not_platform_admin"}
    finally:
        get_settings.cache_clear()


def test_audit_row_written_for_mfa_denied(client, users, monkeypatch, db_session):
    _org, admin, _regular = users
    admin.totp_enabled = False
    admin.totp_secret = None
    db_session.flush()
    _with_admin_emails(monkeypatch, admin.email)
    try:
        assert client.get("/v1/platform-admin/users", headers=_auth(admin)).status_code == 403
        rows = _audit_rows(db_session)
        assert len(rows) == 1
        assert rows[0].allowed is False
        assert rows[0].detail == {"reason": "mfa_not_enrolled"}
    finally:
        get_settings.cache_clear()


def test_rate_limit_returns_429(client, users, monkeypatch, db_session):
    """Sanity check: the slowapi per-IP limit kicks in on platform-admin routes."""
    from app.routes.platform_admin import ADMIN_RATE_LIMIT

    limit = int(ADMIN_RATE_LIMIT.split("/")[0])
    _org, admin, _regular = users
    db_session.add(
        AccessRequest(name="Lead", email="rl@example.com", company="Prospect Co", mail_sent=True)
    )
    db_session.flush()
    _with_admin_emails(monkeypatch, admin.email)
    try:
        for _ in range(limit):
            res = client.get("/v1/platform-admin/access-requests", headers=_auth(admin))
            assert res.status_code == 200
        res = client.get("/v1/platform-admin/access-requests", headers=_auth(admin))
        assert res.status_code == 429
    finally:
        get_settings.cache_clear()


def test_smoke_workspaces_hidden_from_admin_dashboard(client, users, monkeypatch, db_session):
    """CI/smoke orgs must not appear in platform-admin lists."""
    real_org, admin, _regular = users
    smoke_org = Org(
        id=uuid.uuid4(),
        name="Verify Smoke 999",
        slug="verify-smoke-999",
    )
    smoke_user = User(
        id=uuid.uuid4(),
        org_id=smoke_org.id,
        email="smoke@veritrail-smoke-999.com",
        password_hash="x",
        role="owner",
    )
    db_session.add_all([smoke_org, smoke_user])
    db_session.flush()
    _with_admin_emails(monkeypatch, admin.email)
    try:
        ws_res = client.get("/v1/platform-admin/workspaces", headers=_auth(admin))
        assert ws_res.status_code == 200
        ws_ids = {w["id"] for w in ws_res.json()}
        assert str(real_org.id) in ws_ids
        assert str(smoke_org.id) not in ws_ids

        users_res = client.get("/v1/platform-admin/users", headers=_auth(admin))
        assert users_res.status_code == 200
        user_emails = {u["email"] for u in users_res.json()}
        assert smoke_user.email not in user_emails
    finally:
        get_settings.cache_clear()


def test_me_reports_platform_admin_flag(client, users, monkeypatch):
    _org, admin, regular = users
    _with_admin_emails(monkeypatch, admin.email)
    try:
        me_admin = client.get("/v1/auth/me", headers=_auth(admin))
        assert me_admin.status_code == 200
        assert me_admin.json()["platform_admin"] is True

        me_regular = client.get("/v1/auth/me", headers=_auth(regular))
        assert me_regular.status_code == 200
        assert me_regular.json()["platform_admin"] is False
    finally:
        get_settings.cache_clear()
