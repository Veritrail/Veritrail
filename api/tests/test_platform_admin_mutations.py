"""Platform-admin workspace invites and plan management."""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import get_db
from app.core.ratelimit import limiter
from app.core.security import issue_token
from app.models.org import Org, User
from app.models.platform_audit import PlatformAuditLog
from app.models.workspace_creation_invite import WorkspaceCreationInvite
from app.routes.platform_admin import MFA_REQUIRED_DETAIL


@pytest.fixture
def client(db_session, monkeypatch):
    from app.main import app

    monkeypatch.setattr("app.routes.auth.pwned_count", lambda _pw: 0)
    monkeypatch.setattr(
        "app.services.user_session.lookup_ip_geolocation",
        lambda _ip: {"city": None, "region": None, "country": None},
    )

    def _db_override():
        yield db_session

    app.dependency_overrides[get_db] = _db_override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def users(db_session):
    suffix = uuid.uuid4().hex[:8]
    org = Org(id=uuid.uuid4(), name=f"Admin Test Org {suffix}", slug=f"admin-test-{suffix}", plan="trial")
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


STRONG_PASSWORD = "correct-horse-battery-staple-9"


def test_list_plans(client, users, monkeypatch):
    _org, admin, _regular = users
    _with_admin_emails(monkeypatch, admin.email)
    try:
        res = client.get("/v1/platform-admin/plans", headers=_auth(admin))
        assert res.status_code == 200
        slugs = {p["slug"] for p in res.json()}
        assert slugs == {"trial", "starter", "growth", "scale", "enterprise"}
    finally:
        get_settings.cache_clear()


def test_create_workspace_invite(client, users, monkeypatch, db_session):
    _org, admin, _regular = users
    invited_email = f"founder-{uuid.uuid4().hex[:8]}@startup.io"
    _with_admin_emails(monkeypatch, admin.email)
    try:
        res = client.post(
            "/v1/platform-admin/workspace-invites",
            headers=_auth(admin),
            json={
                "email": invited_email,
                "org_name": "Startup Co",
                "plan": "growth",
                "expiry_days": 7,
            },
        )
        assert res.status_code == 201, res.text
        body = res.json()
        assert body["email"] == invited_email
        assert body["org_name"] == "Startup Co"
        assert body["plan"] == "growth"
        assert body["invite_url"].endswith(body["invite_url"].split("/")[-1])
        assert "/invite/" in body["invite_url"]

        invite = db_session.scalar(
            select(WorkspaceCreationInvite).where(WorkspaceCreationInvite.email == invited_email)
        )
        assert invite is not None
        assert invite.plan == "growth"
        assert invite.status == "pending"
        assert invite.expires_at is not None

        audit = db_session.scalars(
            select(PlatformAuditLog).where(PlatformAuditLog.action == "platform_admin.workspace_invite_created")
        ).all()
        assert len(audit) == 1
        assert audit[0].detail["email"] == invited_email
        assert audit[0].detail["suggested_org_name"] == "Startup Co"
    finally:
        get_settings.cache_clear()


def test_create_workspace_invite_rejects_existing_email(client, users, monkeypatch):
    org, admin, regular = users
    _with_admin_emails(monkeypatch, admin.email)
    try:
        res = client.post(
            "/v1/platform-admin/workspace-invites",
            headers=_auth(admin),
            json={"email": regular.email, "plan": "trial"},
        )
        assert res.status_code == 409
    finally:
        get_settings.cache_clear()


def test_non_admin_cannot_create_workspace_invite(client, users, monkeypatch):
    _org, admin, regular = users
    _with_admin_emails(monkeypatch, admin.email)
    try:
        res = client.post(
            "/v1/platform-admin/workspace-invites",
            headers=_auth(regular),
            json={"email": "new@startup.io"},
        )
        assert res.status_code == 404
    finally:
        get_settings.cache_clear()


def test_signup_with_workspace_creation_invite_creates_org(client, users, monkeypatch, db_session):
    _org, admin, _regular = users
    invited_email = f"owner-{uuid.uuid4().hex[:8]}@newco.io"
    _with_admin_emails(monkeypatch, admin.email)
    try:
        created = client.post(
            "/v1/platform-admin/workspace-invites",
            headers=_auth(admin),
            json={"email": invited_email, "org_name": "Ignored Preset", "plan": "starter"},
        )
        assert created.status_code == 201
        token = created.json()["invite_url"].rsplit("/", 1)[-1]

        preview = client.get(f"/v1/members/invites/preview/{token}")
        assert preview.status_code == 200
        assert preview.json()["create_workspace"] is True
        assert preview.json()["plan"] == "starter"
        assert preview.json()["suggested_org_name"] == "Ignored Preset"

        signup = client.post(
            "/v1/auth/signup",
            json={
                "email": invited_email,
                "password": STRONG_PASSWORD,
                "invite_token": token,
                "org_name": "Chosen Workspace",
            },
        )
        assert signup.status_code == 200, signup.text
        new_org_id = signup.json()["org_id"]
        new_org = db_session.get(Org, uuid.UUID(new_org_id))
        assert new_org is not None
        assert new_org.name == "Chosen Workspace"
        assert new_org.plan == "starter"
        assert new_org.slug == "chosen-workspace"

        new_user = db_session.scalar(select(User).where(User.email == invited_email))
        assert new_user is not None
        assert new_user.role == "owner"

        invite = db_session.scalar(
            select(WorkspaceCreationInvite).where(WorkspaceCreationInvite.token == token)
        )
        assert invite is not None
        assert invite.status == "accepted"

        accept_audit = db_session.scalars(
            select(PlatformAuditLog).where(
                PlatformAuditLog.action == "platform_admin.workspace_invite_accepted"
            )
        ).all()
        assert len(accept_audit) == 1
        assert accept_audit[0].detail["workspace_name"] == "Chosen Workspace"
        assert accept_audit[0].detail["accepted_email"] == invited_email
    finally:
        get_settings.cache_clear()


def test_signup_workspace_invite_email_mismatch_rejected(client, users, monkeypatch, db_session):
    _org, admin, _regular = users
    invited_email = f"owner-{uuid.uuid4().hex[:8]}@newco.io"
    _with_admin_emails(monkeypatch, admin.email)
    try:
        created = client.post(
            "/v1/platform-admin/workspace-invites",
            headers=_auth(admin),
            json={"email": invited_email, "plan": "trial"},
        )
        assert created.status_code == 201
        token = created.json()["invite_url"].rsplit("/", 1)[-1]

        signup = client.post(
            "/v1/auth/signup",
            json={
                "email": f"other-{uuid.uuid4().hex[:8]}@newco.io",
                "password": STRONG_PASSWORD,
                "invite_token": token,
                "org_name": "My Workspace",
            },
        )
        assert signup.status_code == 400
        assert "email" in signup.json()["detail"].lower()
    finally:
        get_settings.cache_clear()


def test_signup_workspace_invite_single_use(client, users, monkeypatch, db_session):
    _org, admin, _regular = users
    invited_email = f"owner-{uuid.uuid4().hex[:8]}@newco.io"
    _with_admin_emails(monkeypatch, admin.email)
    try:
        created = client.post(
            "/v1/platform-admin/workspace-invites",
            headers=_auth(admin),
            json={"email": invited_email, "plan": "trial"},
        )
        token = created.json()["invite_url"].rsplit("/", 1)[-1]

        first = client.post(
            "/v1/auth/signup",
            json={
                "email": invited_email,
                "password": STRONG_PASSWORD,
                "invite_token": token,
                "org_name": "First Workspace",
            },
        )
        assert first.status_code == 200

        second = client.post(
            "/v1/auth/signup",
            json={
                "email": f"reuse-{uuid.uuid4().hex[:8]}@newco.io",
                "password": STRONG_PASSWORD,
                "invite_token": token,
                "org_name": "Second Workspace",
            },
        )
        assert second.status_code == 404
    finally:
        get_settings.cache_clear()


def test_signup_workspace_invite_requires_workspace_name(client, users, monkeypatch):
    _org, admin, _regular = users
    invited_email = f"owner-{uuid.uuid4().hex[:8]}@newco.io"
    _with_admin_emails(monkeypatch, admin.email)
    try:
        created = client.post(
            "/v1/platform-admin/workspace-invites",
            headers=_auth(admin),
            json={"email": invited_email, "plan": "trial"},
        )
        token = created.json()["invite_url"].rsplit("/", 1)[-1]

        signup = client.post(
            "/v1/auth/signup",
            json={
                "email": invited_email,
                "password": STRONG_PASSWORD,
                "invite_token": token,
                "org_name": "",
            },
        )
        assert signup.status_code == 400
        assert "workspace name" in signup.json()["detail"].lower()
    finally:
        get_settings.cache_clear()


def test_patch_workspace_plan(client, users, monkeypatch, db_session):
    org, admin, _regular = users
    assert org.plan == "trial"
    _with_admin_emails(monkeypatch, admin.email)
    try:
        res = client.patch(
            f"/v1/platform-admin/workspaces/{org.id}/plan",
            headers=_auth(admin),
            json={"plan": "growth"},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["plan"] == "growth"
        db_session.refresh(org)
        assert org.plan == "growth"

        audit = db_session.scalars(
            select(PlatformAuditLog).where(PlatformAuditLog.action == "platform_admin.plan_changed")
        ).all()
        assert len(audit) == 1
        assert audit[0].detail["old_plan"] == "trial"
        assert audit[0].detail["new_plan"] == "growth"
    finally:
        get_settings.cache_clear()


def test_patch_workspace_plan_rejects_invalid_plan(client, users, monkeypatch):
    org, admin, _regular = users
    _with_admin_emails(monkeypatch, admin.email)
    try:
        res = client.patch(
            f"/v1/platform-admin/workspaces/{org.id}/plan",
            headers=_auth(admin),
            json={"plan": "platinum"},
        )
        assert res.status_code == 422
    finally:
        get_settings.cache_clear()


def test_admin_without_totp_cannot_mutate(client, users, monkeypatch, db_session):
    org, admin, _regular = users
    admin.totp_enabled = False
    admin.totp_secret = None
    db_session.flush()
    _with_admin_emails(monkeypatch, admin.email)
    try:
        invite_res = client.post(
            "/v1/platform-admin/workspace-invites",
            headers=_auth(admin),
            json={"email": "blocked@startup.io"},
        )
        assert invite_res.status_code == 403
        assert invite_res.json()["detail"] == MFA_REQUIRED_DETAIL

        plan_res = client.patch(
            f"/v1/platform-admin/workspaces/{org.id}/plan",
            headers=_auth(admin),
            json={"plan": "growth"},
        )
        assert plan_res.status_code == 403
    finally:
        get_settings.cache_clear()
