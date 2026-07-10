"""Org RBAC: invites, signup, and role enforcement."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.rbac import normalize_role, require_min_role, role_at_least
from app.core.security import issue_token
from app.models.org import Org, User
from app.models.org_team import OrgInvite
from app.services.org_invites import (
    accept_invite_for_user,
    consume_invite_for_signup,
    create_invite,
    ensure_email_invitable,
    get_valid_invite,
    provision_sso_user,
)


def _user(role: str, *, org_id: uuid.UUID | None = None, user_id: uuid.UUID | None = None) -> User:
    u = MagicMock(spec=User)
    u.id = user_id or uuid.uuid4()
    u.org_id = org_id or uuid.uuid4()
    u.email = "user@example.com"
    u.role = role
    return u


# ── RBAC helpers ────────────────────────────────────────────────────


def test_normalize_role_aliases_and_defaults():
    assert normalize_role(None) == "viewer"
    assert normalize_role("member") == "viewer"
    assert normalize_role("ADMIN") == "admin"
    assert normalize_role("bogus") == "viewer"


def test_role_at_least_hierarchy():
    assert role_at_least("owner", "admin")
    assert role_at_least("admin", "admin")
    assert role_at_least("editor", "editor")
    assert not role_at_least("viewer", "editor")
    assert not role_at_least("editor", "admin")


def test_require_min_role_blocks_viewer_from_admin():
    dep = require_min_role("admin")
    viewer = _user("viewer")
    with pytest.raises(HTTPException) as exc:
        dep(user=viewer)
    assert exc.value.status_code == 403


def test_require_min_role_allows_admin():
    dep = require_min_role("admin")
    admin = _user("admin")
    assert dep(user=admin) is admin


# ── Invite service ──────────────────────────────────────────────────


def test_create_invite_persists_pending_invite():
    db = MagicMock()
    org = MagicMock(spec=Org)
    org.id = uuid.uuid4()
    db.scalar.return_value = None

    owner = _user("owner", org_id=org.id)
    invite = create_invite(
        db,
        org=org,
        email="new@example.com",
        role="editor",
        invited_by=owner.id,
        expiry_days=14,
    )

    assert invite.email == "new@example.com"
    assert invite.role == "editor"
    assert invite.status == "pending"
    assert invite.token
    db.add.assert_called_once()


def test_consume_invite_for_signup_sets_role_and_accepts():
    db = MagicMock()
    org_id = uuid.uuid4()
    org = MagicMock(spec=Org)
    org.id = org_id
    invite = OrgInvite(
        org_id=org_id,
        email="join@example.com",
        role="viewer",
        token="abc" * 16,
        status="pending",
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db.scalar.return_value = invite
    db.get.return_value = org

    org_out, role = consume_invite_for_signup(db, invite.token, "join@example.com")

    assert org_out is org
    assert role == "viewer"
    assert invite.status == "accepted"
    assert invite.accepted_at is not None


def test_ensure_email_invitable_allows_unknown_email():
    db = MagicMock()
    org = MagicMock(spec=Org)
    org.id = uuid.uuid4()
    db.scalar.side_effect = [None, None]

    ensure_email_invitable(db, org, "contractor@gmail.com")


def test_ensure_email_invitable_rejects_existing_member():
    db = MagicMock()
    org = MagicMock(spec=Org)
    org.id = uuid.uuid4()
    existing = MagicMock(spec=User)
    existing.id = uuid.uuid4()
    membership = MagicMock()
    db.scalar.side_effect = [existing, membership]

    with pytest.raises(HTTPException) as exc:
        ensure_email_invitable(db, org, "member@example.com")
    assert exc.value.status_code == 409
    assert exc.value.detail == "User is already a member of this workspace"


def test_ensure_email_invitable_allows_user_on_other_workspace():
    db = MagicMock()
    org = MagicMock(spec=Org)
    org.id = uuid.uuid4()
    existing = MagicMock(spec=User)
    existing.id = uuid.uuid4()
    existing.org_id = uuid.uuid4()
    db.scalar.side_effect = [existing, None, None]

    ensure_email_invitable(db, org, "zenmyx@gmail.com")


def test_ensure_email_invitable_rejects_pending_invite():
    db = MagicMock()
    org = MagicMock(spec=Org)
    org.id = uuid.uuid4()
    pending = MagicMock(spec=OrgInvite)
    db.scalar.side_effect = [None, pending]

    with pytest.raises(HTTPException) as exc:
        ensure_email_invitable(db, org, "pending@example.com")
    assert exc.value.status_code == 409
    assert exc.value.detail == "Pending invite already exists for this email"


def test_get_valid_invite_rejects_email_mismatch():
    db = MagicMock()
    invite = OrgInvite(
        org_id=uuid.uuid4(),
        email="a@example.com",
        role="viewer",
        token="tok" + "x" * 61,
        status="pending",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db.scalar.return_value = invite

    with pytest.raises(HTTPException) as exc:
        get_valid_invite(db, invite.token, email="b@example.com")
    assert exc.value.status_code == 400


def test_accept_invite_for_user_cross_org_switches_workspace():
    """Existing user on solo org can accept invite into another workspace."""
    from app.models.org_team import OrgMembership

    solo_org = uuid.uuid4()
    target_org = uuid.uuid4()
    user = MagicMock(spec=User)
    user.id = uuid.uuid4()
    user.email = "zenmyx@gmail.com"
    user.org_id = solo_org
    user.role = "owner"

    org = MagicMock(spec=Org)
    org.id = target_org
    org.name = "Cloud Castles"

    invite = OrgInvite(
        org_id=target_org,
        email="zenmyx@gmail.com",
        role="viewer",
        token="x" * 64,
        status="pending",
        expires_at=None,
    )
    new_membership = OrgMembership(
        id=uuid.uuid4(),
        user_id=user.id,
        org_id=target_org,
        role="viewer",
    )

    db = MagicMock()
    db.get.return_value = org
    db.scalar.side_effect = [invite, None, new_membership]

    with patch("app.services.org_invites.add_membership", return_value=new_membership):
        org_out, role = accept_invite_for_user(db, invite.token, user)

    db.flush.assert_called()
    assert org_out is org
    assert role == "viewer"
    assert user.org_id == target_org
    assert user.role == "viewer"
    assert invite.status == "accepted"
    assert invite.accepted_at is not None


# ── Members routes (mocked DB) ──────────────────────────────────────


def test_list_invites_owner_only():
    from app.routes.members import list_invites

    owner = _user("owner")
    db = MagicMock()
    invite = OrgInvite(
        id=uuid.uuid4(),
        org_id=owner.org_id,
        email="pending@example.com",
        role="editor",
        token="t" * 64,
        status="pending",
        expires_at=datetime.now(timezone.utc) + timedelta(days=14),
        created_at=datetime.now(timezone.utc),
    )
    db.scalars.return_value.all.return_value = [invite]

    with patch("app.routes.members.get_settings") as mock_settings:
        mock_settings.return_value.FRONTEND_URL = "http://localhost:5173"
        out = list_invites(user=owner, db=db)

    assert len(out) == 1
    assert out[0].email == "pending@example.com"
    assert out[0].invite_url.endswith(f"/invite/{invite.token}")


def test_revoke_invite_marks_revoked():
    from app.routes.members import revoke_invite

    owner = _user("owner")
    invite_id = uuid.uuid4()
    invite = OrgInvite(
        id=invite_id,
        org_id=owner.org_id,
        email="gone@example.com",
        role="viewer",
        token="r" * 64,
        status="pending",
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db = MagicMock()
    db.get.return_value = invite

    with patch("app.routes.members.log_org_activity"):
        result = revoke_invite(str(invite_id), user=owner, db=db)

    assert result == {"ok": True}
    assert invite.status == "revoked"
    db.commit.assert_called_once()


# ── Signup with invite_token ────────────────────────────────────────


def test_signup_with_invite_token_assigns_role_via_consume():
    """Signup path uses consume_invite_for_signup — verify role assignment."""
    db = MagicMock()
    org_id = uuid.uuid4()
    org = MagicMock(spec=Org)
    org.id = org_id
    invite = OrgInvite(
        org_id=org_id,
        email="join@example.com",
        role="editor",
        token="invite-token",
        status="pending",
        expires_at=datetime.now(timezone.utc) + timedelta(days=14),
    )
    db.scalar.return_value = invite
    db.get.return_value = org

    org_out, role = consume_invite_for_signup(db, invite.token, "join@example.com")
    assert org_out is org
    assert role == "editor"
    assert invite.status == "accepted"


# ── Route enforcement via TestClient ────────────────────────────────


@pytest.fixture
def client():
    from app.main import app

    return TestClient(app)


def _auth_header(role: str, org_id: str | None = None, user_id: str | None = None) -> dict[str, str]:
    oid = org_id or str(uuid.uuid4())
    uid = user_id or str(uuid.uuid4())
    token = issue_token(uid, oid)
    return {"Authorization": f"Bearer {token}"}


def test_viewer_cannot_create_account(client, monkeypatch):
    from app.core.rbac import current_org_user

    org_id = str(uuid.uuid4())
    viewer = _user("viewer", org_id=uuid.UUID(org_id))

    def _override():
        return viewer

    client.app.dependency_overrides[current_org_user] = _override
    try:
        res = client.post(
            "/v1/accounts",
            headers=_auth_header("viewer", org_id),
            json={"label": "Test", "enable_advanced_policy_generation": False},
        )
        assert res.status_code == 403
    finally:
        client.app.dependency_overrides.clear()


def test_admin_can_create_account_route_passes_rbac(client, monkeypatch):
    from app.core.rbac import current_org_user

    org_id = str(uuid.uuid4())
    admin = _user("admin", org_id=uuid.UUID(org_id))

    def _override():
        return admin

    client.app.dependency_overrides[current_org_user] = _override

    try:
        res = client.post(
            "/v1/accounts",
            headers=_auth_header("admin", org_id),
            json={"label": "Test", "enable_advanced_policy_generation": False},
        )
        assert res.status_code != 403
    finally:
        client.app.dependency_overrides.clear()


def test_editor_meets_editor_requirement():
    dep = require_min_role("editor")
    editor = _user("editor")
    assert dep(user=editor) is editor


def test_viewer_cannot_snooze_via_require_editor():
    dep = require_min_role("editor")
    viewer = _user("viewer")
    with pytest.raises(HTTPException) as exc:
        dep(user=viewer)
    assert exc.value.status_code == 403


def test_viewer_cannot_snooze_finding(client):
    from app.core.rbac import current_org_user

    org_id = uuid.uuid4()
    viewer = _user("viewer", org_id=org_id)
    client.app.dependency_overrides[current_org_user] = lambda: viewer
    finding_id = str(uuid.uuid4())

    try:
        res = client.post(
            f"/v1/findings/{finding_id}/snooze",
            headers=_auth_header("viewer", str(org_id)),
            json={"days": 7},
        )
        assert res.status_code == 403
    finally:
        client.app.dependency_overrides.clear()


def test_auth_me_includes_role(client):
    from app.core.db import get_db
    from app.core.security import current_principal

    user_id = uuid.uuid4()
    org_id = uuid.uuid4()
    user = MagicMock()
    user.id = user_id
    user.org_id = org_id
    user.email = "owner@acme.com"
    user.display_name = "Acme Owner"
    user.role = "owner"
    user.github_id = None
    user.gitlab_id = None
    user.google_id = None
    user.totp_enabled = False
    user.password_hash = "hashed"
    user.mfa_backup_codes = []

    org = MagicMock()
    org.name = "Acme Corp"

    db = MagicMock()
    db.get.side_effect = [user, org]

    client.app.dependency_overrides[current_principal] = lambda: {
        "sub": str(user_id),
        "org_id": str(org_id),
    }
    client.app.dependency_overrides[get_db] = lambda: db

    membership = MagicMock()
    membership.role = "owner"
    with patch("app.services.org_membership.list_memberships", return_value=[(membership, org)]):
        try:
            res = client.get("/v1/auth/me", headers=_auth_header("owner", str(org_id), str(user_id)))
            assert res.status_code == 200
            body = res.json()
            assert body["role"] == "owner"
            assert body["org_id"] == str(org_id)
            assert body["org_name"] == "Acme Corp"
            assert body["email"] == "owner@acme.com"
            assert body["display_name"] == "Acme Owner"
            assert body["has_password"] is True
            assert body["has_workspace"] is True
        finally:
            client.app.dependency_overrides.clear()


def test_auth_me_reports_no_workspace_when_memberships_empty(client):
    from app.core.db import get_db
    from app.core.security import current_principal

    user_id = uuid.uuid4()
    org_id = uuid.uuid4()
    user = MagicMock()
    user.id = user_id
    user.org_id = org_id
    user.email = "orphan@acme.com"
    user.display_name = "Orphan User"
    user.role = "viewer"
    user.github_id = None
    user.gitlab_id = None
    user.google_id = None
    user.totp_enabled = False
    user.password_hash = "hashed"
    user.mfa_backup_codes = []

    db = MagicMock()
    db.get.side_effect = [user, None]

    client.app.dependency_overrides[current_principal] = lambda: {
        "sub": str(user_id),
        "org_id": str(org_id),
    }
    client.app.dependency_overrides[get_db] = lambda: db

    with patch("app.services.org_membership.list_memberships", return_value=[]):
        try:
            res = client.get("/v1/auth/me", headers=_auth_header("viewer", str(org_id), str(user_id)))
            assert res.status_code == 200
            body = res.json()
            assert body["has_workspace"] is False
            assert body["email"] == "orphan@acme.com"
        finally:
            client.app.dependency_overrides.clear()


def test_domain_managed_blocks_new_workspace():
    from app.services.org_domain import assert_domain_available_for_new_workspace

    org_id = uuid.uuid4()
    db = MagicMock()
    db.scalar.return_value = org_id
    org = MagicMock()
    org.name = "Acme Corp"
    db.get.return_value = org

    with pytest.raises(HTTPException) as exc:
        assert_domain_available_for_new_workspace(db, "newhire@acme.com")
    assert exc.value.status_code == 409
    assert "invite" in str(exc.value.detail).lower()


def test_provision_sso_user_returns_signup_pending_without_invite():
    db = MagicMock()
    db.scalar.side_effect = [None, None]

    with pytest.raises(HTTPException) as exc:
        provision_sso_user(db, email="new@gmail.com", google_id="gid-1")
    assert exc.value.status_code == 403
    assert exc.value.detail == "signup_pending"


def test_signup_pending_token_roundtrip():
    from app.core.security import decode_signup_pending_token, issue_signup_pending_token

    tok = issue_signup_pending_token("user@gmail.com", google_id="g123")
    payload = decode_signup_pending_token(tok)
    assert payload["email"] == "user@gmail.com"
    assert payload["google_id"] == "g123"


def test_complete_signup_without_invite_is_rejected(client):
    """Self-registration is disabled — complete-signup requires a workspace invite."""
    from app.core.db import get_db
    from app.core.security import issue_signup_pending_token

    signup_token = issue_signup_pending_token("sso-new@gmail.com", google_id="g-new")
    db = MagicMock()
    db.scalar.return_value = None
    db.get.return_value = None

    client.app.dependency_overrides[get_db] = lambda: db

    try:
        res = client.post(
            "/v1/auth/complete-signup",
            json={"signup_token": signup_token, "org_name": "My Workspace"},
        )
        assert res.status_code == 403
        assert "invite-only" in res.json()["detail"]
        assert not db.add_all.called
    finally:
        client.app.dependency_overrides.clear()


def test_switch_workspace_returns_new_tokens(client):
    from app.core.db import get_db
    from app.core.security import current_user_principal
    from app.models.org_team import OrgMembership

    user_id = uuid.uuid4()
    org_a = uuid.uuid4()
    org_b = uuid.uuid4()
    user = MagicMock()
    user.id = user_id
    user.org_id = org_a
    user.email = "multi@example.com"
    user.role = "owner"
    user.totp_enabled = False

    membership_b = MagicMock(spec=OrgMembership)
    membership_b.org_id = org_b
    membership_b.role = "viewer"

    target_org = MagicMock(spec=Org)
    target_org.settings = {}

    db = MagicMock()
    db.get.side_effect = lambda model, pk: {
        user_id: user,
        org_b: target_org,
    }.get(pk)
    db.scalar.return_value = membership_b

    client.app.dependency_overrides[current_user_principal] = lambda: {
        "sub": str(user_id),
        "org_id": str(org_a),
    }
    client.app.dependency_overrides[get_db] = lambda: db

    try:
        res = client.post(
            "/v1/auth/workspaces/switch",
            headers=_auth_header("owner", str(org_a), str(user_id)),
            json={"org_id": str(org_b)},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["org_id"] == str(org_b)
        assert body["access_token"]
        assert user.org_id == org_b
        assert user.role == "viewer"
    finally:
        client.app.dependency_overrides.clear()
