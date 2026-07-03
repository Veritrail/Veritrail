"""Phase 8.5 tests: GCP firewall pairing, CAI role grading, SSO enforcement."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.checks.gcp_asset_public_iam_binding import run as run_asset_check
from app.checks.gcp_firewall_open_ingress import run as run_firewall_check
from app.collectors.gcp.firewall import collect_firewall_rules, firewall_allows_world_ingress
from app.core.security import issue_refresh_token
from app.models.org import Org, User
from app.models.user_session import UserSession
from app.routes.auth import refresh
from app.services.gcp_client import GcpClient
from app.services.org_sso_policy import (
    assert_password_auth_allowed,
    assert_session_allowed_for_org,
    org_sso_required,
)
from app.services.user_session import hash_refresh_token


def test_firewall_allows_world_ingress_detects_open_rule():
    assert firewall_allows_world_ingress(
        {
            "direction": "INGRESS",
            "disabled": False,
            "sourceRanges": ["0.0.0.0/0"],
        }
    )
    assert not firewall_allows_world_ingress(
        {
            "direction": "INGRESS",
            "disabled": False,
            "sourceRanges": ["10.0.0.0/8"],
        }
    )


def test_collect_firewall_rules_upserts(mock_db):
    project = MagicMock()
    project.id = uuid.uuid4()
    project.project_id = "demo-project"
    project.auth_method = "workload_identity"

    rules = [
        {
            "id": "100",
            "name": "allow-all",
            "network": "https://www.googleapis.com/compute/v1/projects/demo-project/global/networks/default",
            "direction": "INGRESS",
            "disabled": False,
            "sourceRanges": ["0.0.0.0/0"],
            "targetTags": ["web"],
        }
    ]
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(
            "app.collectors.gcp.firewall.GcpClient.from_project",
            lambda _p: MagicMock(list_firewall_rules=lambda _pid: rules),
        )
        count = collect_firewall_rules(mock_db, project)
    assert count == 1
    mock_db.execute.assert_called()


def test_gcp_firewall_open_ingress_pairs_public_ip_and_world_rule():
    db = MagicMock()
    project_id = uuid.uuid4()
    project = MagicMock()
    project.project_id = "demo-project"
    db.get.return_value = project

    inst = MagicMock()
    inst.instance_id = "123"
    inst.name = "web-1"
    inst.zone = "us-central1-a"
    inst.has_public_ip = True
    inst.network = "https://www.googleapis.com/compute/v1/projects/demo-project/global/networks/default"
    inst.tags = ["web"]

    rule = MagicMock()
    rule.name = "allow-all"
    rule.network = inst.network
    rule.target_tags = ["web"]
    rule.allows_world_ingress = True

    db.scalars.return_value.all.side_effect = [[inst], [rule]]

    drafts = run_firewall_check(db, project_id)
    assert len(drafts) == 1
    assert drafts[0].severity == "high"
    assert "allow-all" in drafts[0].evidence["matching_firewall_rules"]


def test_gcp_asset_public_iam_binding_grades_editor_higher_than_viewer():
    db = MagicMock()
    project_id = uuid.uuid4()
    project = MagicMock()
    project.project_id = "demo-project"
    db.get.return_value = project

    editor_asset = MagicMock()
    editor_asset.asset_name = "//storage.googleapis.com/editor-bucket"
    editor_asset.asset_type = "storage.googleapis.com/Bucket"
    editor_asset.has_public_iam = True
    editor_asset.public_iam_roles = ["roles/storage.admin"]

    viewer_asset = MagicMock()
    viewer_asset.asset_name = "//storage.googleapis.com/viewer-bucket"
    viewer_asset.asset_type = "storage.googleapis.com/Bucket"
    viewer_asset.has_public_iam = True
    viewer_asset.public_iam_roles = ["roles/storage.objectViewer"]

    db.scalars.return_value.all.return_value = [editor_asset, viewer_asset]

    drafts = run_asset_check(db, project_id)
    by_name = {d.evidence["asset_name"]: d for d in drafts}
    assert by_name[editor_asset.asset_name].severity == "high"
    assert by_name[viewer_asset.asset_name].severity == "medium"


def test_gcp_client_public_iam_roles():
    roles = GcpClient.public_iam_roles(
        {
            "iamPolicy": {
                "bindings": [
                    {"members": ["allUsers"], "role": "roles/editor"},
                    {"members": ["user:alice@example.com"], "role": "roles/viewer"},
                ]
            }
        }
    )
    assert roles == ["roles/editor"]


def test_org_sso_required_reads_settings():
    org = Org(id=uuid.uuid4(), name="Acme", settings={"security": {"sso_required": True}})
    assert org_sso_required(org)


def test_assert_password_auth_blocked_when_sso_required():
    org = Org(id=uuid.uuid4(), name="Acme", settings={"security": {"sso_required": True}})
    with pytest.raises(HTTPException) as exc:
        assert_password_auth_allowed(org)
    assert exc.value.status_code == 403


def test_assert_session_rejected_for_password_when_sso_required():
    org = Org(id=uuid.uuid4(), name="Acme", settings={"security": {"sso_required": True}})
    session = UserSession(user_id=uuid.uuid4(), token_hash="abc")
    session.auth_method = "password"
    with pytest.raises(HTTPException) as exc:
        assert_session_allowed_for_org(org, session)
    assert exc.value.status_code == 401


def test_refresh_rejects_password_session_when_sso_required(monkeypatch):
    from app.routes import auth as auth_routes

    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    org = Org(id=org_id, name="SSO Org", settings={"security": {"sso_required": True}})
    user = User(id=user_id, org_id=org_id, email="sso-user@example.com", password_hash="hash", role="owner")
    refresh_token = issue_refresh_token(str(user_id), str(org_id), remember_me=True)
    session = UserSession(user_id=user_id, token_hash=hash_refresh_token(refresh_token), auth_method="password")

    db = MagicMock()
    db.get.side_effect = lambda model, pk: {
        user_id: user,
        org_id: org,
    }.get(pk)

    monkeypatch.setattr(auth_routes, "refresh_token_from_request", lambda _req, _body: refresh_token)
    monkeypatch.setattr(auth_routes, "get_session_for_refresh", lambda _db, _uid, _raw: session)

    request = MagicMock()
    with pytest.raises(HTTPException) as exc:
        auth_routes.refresh(request, body=auth_routes.RefreshIn(refresh_token=refresh_token), db=db)
    assert exc.value.status_code == 401
