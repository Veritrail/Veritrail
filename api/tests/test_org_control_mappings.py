"""Tests for per-org control mapping overrides (Phase 7)."""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.db import get_db
from app.core.security import current_principal
from app.main import app
from app.models.control import Control
from app.models.org import Org, User
from app.services.check_controls import check_control_bundle, controls_for_check, global_control_checks
from app.services.composite_controls import list_composite_controls, soc2_control_checks
from app.services.org_control_mappings import (
    effective_check_ids,
    merge_effective_checks,
    upsert_org_mapping,
)
from app.services.org_membership import add_membership
from app.services.seed_controls import effective_checks_for_control_row


def test_merge_effective_checks_add_and_remove():
    global_checks = ["a.check", "b.check", "c.check"]
    out = merge_effective_checks(global_checks, added=["d.check"], removed=["b.check"])
    assert out == ["a.check", "c.check", "d.check"]


def test_effective_check_ids_falls_back_to_global():
    global_checks = global_control_checks("soc2", "CC6.1")
    assert global_checks
    assert effective_check_ids(global_checks) == sorted(global_checks)


def test_org_override_add_and_remove(db_session):
    org_id = uuid.uuid4()
    db_session.add(Org(id=org_id, name="Mapping Org"))
    db_session.flush()

    global_checks = global_control_checks("soc2", "CC6.1")
    added = "iam.policy.unattached"
    removed = global_checks[0]

    upsert_org_mapping(
        db_session,
        org_id,
        "soc2",
        "CC6.1",
        added_check_ids=[added],
        removed_check_ids=[removed],
    )
    db_session.flush()

    effective = soc2_control_checks("CC6.1", org_id=org_id, db=db_session)
    assert added in effective
    assert removed not in effective
    assert set(global_checks) - {removed} | {added} == set(effective)


def test_controls_for_check_respects_org_override(db_session):
    org_id = uuid.uuid4()
    db_session.add(Org(id=org_id, name="Mapping Org"))
    db_session.flush()

    added = "iam.policy.unattached"
    upsert_org_mapping(
        db_session,
        org_id,
        "soc2",
        "CC6.1",
        added_check_ids=[added],
        removed_check_ids=[],
    )
    db_session.flush()

    rows = controls_for_check(added, org_id=org_id, db=db_session)
    assert any(r["framework"] == "soc2" and r["control_id"] == "CC6.1" for r in rows)

    bundle = check_control_bundle(added, org_id=org_id, db=db_session)
    assert bundle["primary"]["control_id"] == "CC6.1"


def test_effective_checks_for_control_row(db_session):
    org_id = uuid.uuid4()
    db_session.add(Org(id=org_id, name="Row Org"))
    db_session.flush()

    ctrl = db_session.scalars(select(Control).where(Control.control_id == "CC6.1")).first()
    assert ctrl is not None
    global_checks = global_control_checks(ctrl.framework, ctrl.control_id)
    removed = global_checks[0]
    upsert_org_mapping(
        db_session,
        org_id,
        ctrl.framework,
        ctrl.control_id,
        added_check_ids=[],
        removed_check_ids=[removed],
    )
    db_session.flush()

    effective = effective_checks_for_control_row(db_session, org_id, ctrl, global_checks)
    assert removed not in effective
    assert len(effective) == len(global_checks) - 1


def test_composite_list_uses_org_override(db_session):
    org_id = uuid.uuid4()
    db_session.add(Org(id=org_id, name="Composite Org"))
    db_session.flush()

    added = "iam.root.has_access_keys"
    upsert_org_mapping(
        db_session,
        org_id,
        "soc2",
        "CC6.1",
        added_check_ids=[added],
        removed_check_ids=[],
    )
    db_session.flush()

    rows = list_composite_controls(db_session, org_id, account_id=None)
    asset = next(r for r in rows if r["id"] == "asset_inventory")
    assert added in asset["check_ids"]


def test_upsert_rejects_unknown_check(db_session):
    org_id = uuid.uuid4()
    db_session.add(Org(id=org_id, name="Bad Check Org"))
    db_session.flush()
    with pytest.raises(ValueError, match="unknown check_id"):
        upsert_org_mapping(
            db_session,
            org_id,
            "soc2",
            "CC6.1",
            added_check_ids=["not.a.real.check"],
            removed_check_ids=[],
        )


def test_upsert_clears_empty_override(db_session):
    org_id = uuid.uuid4()
    db_session.add(Org(id=org_id, name="Clear Org"))
    db_session.flush()
    row = upsert_org_mapping(
        db_session,
        org_id,
        "soc2",
        "CC6.1",
        added_check_ids=["iam.policy.unattached"],
        removed_check_ids=[],
    )
    assert row is not None
    cleared = upsert_org_mapping(
        db_session,
        org_id,
        "soc2",
        "CC6.1",
        added_check_ids=[],
        removed_check_ids=[],
    )
    assert cleared is None


@pytest.fixture
def client():
    return TestClient(app)


def _auth_header(role: str, org_id: str, user_id: str) -> dict[str, str]:
    from app.core.security import issue_token

    token = issue_token(user_id, org_id)
    return {"Authorization": f"Bearer {token}"}


def test_control_mapping_routes_admin_only(client, db_session):
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    db_session.add(Org(id=org_id, name="Route Org"))
    db_session.add(
        User(id=user_id, org_id=org_id, email="editor@route.test", password_hash="x", role="editor")
    )
    add_membership(db_session, user_id, org_id, "editor")
    db_session.flush()

    client.app.dependency_overrides[get_db] = lambda: db_session
    client.app.dependency_overrides[current_principal] = lambda: {
        "sub": str(user_id),
        "org_id": str(org_id),
        "role": "editor",
    }
    try:
        res = client.put(
            "/v1/controls/control-mappings/soc2/CC6.1",
            headers=_auth_header("editor", str(org_id), str(user_id)),
            json={"added_check_ids": ["iam.policy.unattached"], "removed_check_ids": []},
        )
        assert res.status_code == 403
    finally:
        client.app.dependency_overrides.clear()


def test_control_mapping_put_and_list(client, db_session):
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    db_session.add(Org(id=org_id, name="Admin Org"))
    db_session.add(
        User(id=user_id, org_id=org_id, email="admin@route.test", password_hash="x", role="admin")
    )
    add_membership(db_session, user_id, org_id, "admin")
    db_session.flush()

    client.app.dependency_overrides[get_db] = lambda: db_session
    client.app.dependency_overrides[current_principal] = lambda: {
        "sub": str(user_id),
        "org_id": str(org_id),
        "role": "admin",
    }
    try:
        put = client.put(
            "/v1/controls/control-mappings/soc2/CC6.1",
            headers=_auth_header("admin", str(org_id), str(user_id)),
            json={"added_check_ids": ["iam.policy.unattached"], "removed_check_ids": []},
        )
        assert put.status_code == 200, put.text
        body = put.json()
        assert "iam.policy.unattached" in body["effective_check_ids"]
        assert body["has_override"] is True

        listed = client.get(
            "/v1/controls/control-mappings?framework=soc2&overrides_only=true",
            headers=_auth_header("admin", str(org_id), str(user_id)),
        )
        assert listed.status_code == 200
        refs = {row["control_id"] for row in listed.json()}
        assert "CC6.1" in refs
    finally:
        client.app.dependency_overrides.clear()
