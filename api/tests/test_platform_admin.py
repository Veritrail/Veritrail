"""Platform-admin dashboard endpoints — env-gated by PLATFORM_ADMIN_EMAILS."""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import issue_token
from app.models.access_request import AccessRequest
from app.models.org import Org, User


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
    org = Org(id=uuid.uuid4(), name=f"Admin Test Org {suffix}", slug=f"admin-test-{suffix}")
    admin = User(
        id=uuid.uuid4(),
        org_id=org.id,
        email=f"ellie-{suffix}@cloud-castles.com",
        password_hash="x",
        role="owner",
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
