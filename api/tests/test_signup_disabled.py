"""Self-registration is disabled — accounts come only from workspace invites."""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.db import get_db
from app.routes.auth import SIGNUPS_DISABLED_MESSAGE

STRONG_PASSWORD = "correct-horse-battery-staple-9"


@pytest.fixture
def client(db_session, monkeypatch):
    from app.main import app

    # No external calls during signup/login: HIBP password check + session IP geolocation.
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


def _make_org_with_owner(db_session, *, email_domain="example.com"):
    from app.core.passwords import hash_password
    from app.models.org import Org, User
    from app.services.org_membership import add_membership

    suffix = uuid.uuid4().hex[:8]
    org = Org(id=uuid.uuid4(), name=f"Org {suffix}", slug=f"org-{suffix}")
    owner = User(
        id=uuid.uuid4(),
        org_id=org.id,
        email=f"owner-{suffix}@{email_domain}",
        password_hash=hash_password(STRONG_PASSWORD),
        role="owner",
    )
    db_session.add_all([org, owner])
    db_session.flush()
    add_membership(db_session, owner.id, org.id, "owner")
    db_session.flush()
    return org, owner


def test_signup_without_invite_is_rejected(client, db_session):
    from app.models.org import User

    email = f"newcomer-{uuid.uuid4().hex[:8]}@example.com"
    res = client.post(
        "/v1/auth/signup",
        json={"email": email, "password": STRONG_PASSWORD, "org_name": "My Startup"},
    )
    assert res.status_code == 403
    assert res.json()["detail"] == SIGNUPS_DISABLED_MESSAGE
    assert db_session.scalar(select(User).where(User.email == email)) is None


def test_signup_with_invite_still_works(client, db_session):
    from app.services.org_invites import create_invite

    org, owner = _make_org_with_owner(db_session)
    invited_email = f"guest-{uuid.uuid4().hex[:8]}@anywhere.org"
    invite = create_invite(db_session, org=org, email=invited_email, role="viewer", invited_by=owner.id)
    db_session.flush()

    res = client.post(
        "/v1/auth/signup",
        json={
            "email": invited_email,
            "password": STRONG_PASSWORD,
            "org_name": "",
            "invite_token": invite.token,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["access_token"]
    assert body["org_id"] == str(org.id)


def test_complete_signup_without_invite_is_rejected(client):
    from app.core.security import issue_signup_pending_token

    token = issue_signup_pending_token(f"sso-{uuid.uuid4().hex[:8]}@example.com", google_id="g123")
    res = client.post(
        "/v1/auth/complete-signup",
        json={"signup_token": token, "org_name": "New Org"},
    )
    assert res.status_code == 403
    assert res.json()["detail"] == SIGNUPS_DISABLED_MESSAGE


def test_login_works_for_existing_user_on_any_domain(client, db_session):
    """No domain gate on sign-in — existing users keep access."""
    _org, owner = _make_org_with_owner(db_session, email_domain="some-customer.net")

    res = client.post(
        "/v1/auth/login",
        json={"email": owner.email, "password": STRONG_PASSWORD},
    )
    assert res.status_code == 200, res.text
    assert res.json()["access_token"]
