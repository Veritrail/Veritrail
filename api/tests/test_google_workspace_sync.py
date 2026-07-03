from __future__ import annotations

import json
import uuid
from unittest.mock import MagicMock, patch

import httpx

from app.models.github import IdentityProvider
from app.services.google_workspace_sync import assert_admin_directory_scopes, sync_google_workspace_provider


def test_sync_google_workspace_users_and_mfa_flag():
    provider = IdentityProvider(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        type="google_workspace",
        config_json_encrypted=json.dumps({"domain": "example.com", "access_token": "tok"}),
    )
    db = MagicMock()

    users_resp = httpx.Response(
        200,
        json={
            "users": [
                {
                    "id": "1",
                    "primaryEmail": "alice@example.com",
                    "name": {"fullName": "Alice"},
                    "suspended": False,
                    "isEnrolledIn2Sv": True,
                    "isEnforcedIn2Sv": True,
                    "lastLoginTime": "2026-01-01T00:00:00Z",
                },
                {
                    "id": "2",
                    "primaryEmail": "bob@example.com",
                    "name": {"fullName": "Bob"},
                    "suspended": False,
                    "isEnrolledIn2Sv": False,
                    "isEnforcedIn2Sv": False,
                },
            ]
        },
        request=httpx.Request("GET", "https://admin.googleapis.com/admin/directory/v1/users"),
    )
    roles_resp = httpx.Response(
        200,
        json={"items": [{"roleId": "_SUPER_ADMIN_ROLE", "assignedTo": "1"}]},
        request=httpx.Request("GET", "https://admin.googleapis.com/admin/directory/v1/customer/my_customer/roleassignments"),
    )

    def fake_get(url, params=None):
        if url.endswith("/users"):
            return users_resp
        if "roleassignments" in url:
            return roles_resp
        raise AssertionError(url)

    db.scalar.return_value = None

    with (
        patch("app.services.google_workspace_sync.assert_admin_directory_scopes"),
        patch("app.services.google_workspace_tokens.ensure_google_workspace_token", return_value="tok"),
        patch("httpx.Client") as client_cls,
    ):
        client = client_cls.return_value.__enter__.return_value
        client.get.side_effect = fake_get
        stats = sync_google_workspace_provider(db, provider)

    assert stats.identity_users == 2
    assert stats.admin_users == 1
    cfg = json.loads(provider.config_json_encrypted)
    assert cfg["two_step_verification_enforced"] is False


def test_sync_raises_when_directory_api_returns_403():
    provider = IdentityProvider(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        type="google_workspace",
        config_json_encrypted=json.dumps({"domain": "example.com", "access_token": "tok"}),
    )
    db = MagicMock()
    forbidden = httpx.Response(
        403,
        json={
            "error": {
                "code": 403,
                "message": "Request had insufficient authentication scopes.",
                "status": "PERMISSION_DENIED",
            }
        },
        request=httpx.Request("GET", "https://admin.googleapis.com/admin/directory/v1/users"),
    )

    def fake_get(url, params=None):
        if url.endswith("/users"):
            return forbidden
        if "roleassignments" in url:
            return forbidden
        raise AssertionError(url)

    db.scalar.return_value = None

    with (
        patch("app.services.google_workspace_sync.assert_admin_directory_scopes"),
        patch("app.services.google_workspace_tokens.ensure_google_workspace_token", return_value="tok"),
        patch("httpx.Client") as client_cls,
    ):
        client = client_cls.return_value.__enter__.return_value
        client.get.side_effect = fake_get
        try:
            sync_google_workspace_provider(db, provider)
            raised = False
        except ValueError as e:
            raised = True
            assert "Admin Directory scopes" in str(e)

    assert raised


def test_assert_admin_directory_scopes_raises_when_missing():
    tokeninfo = httpx.Response(
        200,
        json={"scope": "openid email profile"},
        request=httpx.Request("GET", "https://oauth2.googleapis.com/tokeninfo"),
    )
    with patch("httpx.Client") as client_cls:
        client = client_cls.return_value.__enter__.return_value
        client.get.return_value = tokeninfo
        try:
            assert_admin_directory_scopes("tok")
            raised = False
        except ValueError as e:
            raised = True
            assert "Admin Directory scopes" in str(e)
    assert raised
