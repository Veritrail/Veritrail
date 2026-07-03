"""Evidence RBAC: role helpers and route 403 enforcement."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.evidence_rbac import (
    assert_evidence_readable,
    can_review_evidence,
    can_upload_evidence,
    default_evidence_role_for_org_role,
    evidence_in_pack_scope,
    membership_evidence_role,
    normalize_evidence_role,
    require_evidence_review,
    require_evidence_upload,
)
from app.models.evidence_artifact import EvidenceArtifact
from app.models.org import Org, User
from app.models.org_team import OrgMembership
from app.services.org_membership import add_membership


def _user(role: str, *, org_id: uuid.UUID | None = None, user_id: uuid.UUID | None = None) -> User:
    u = MagicMock(spec=User)
    u.id = user_id or uuid.uuid4()
    u.org_id = org_id or uuid.uuid4()
    u.email = "user@example.com"
    u.role = role
    return u


def test_default_evidence_role_from_org_role():
    assert default_evidence_role_for_org_role("owner") == "reviewer"
    assert default_evidence_role_for_org_role("admin") == "reviewer"
    assert default_evidence_role_for_org_role("editor") == "contributor"
    assert default_evidence_role_for_org_role("viewer") == "auditor-viewer"


def test_normalize_evidence_role_prefers_explicit():
    assert normalize_evidence_role("auditor-viewer", fallback_org_role="admin") == "auditor-viewer"
    assert normalize_evidence_role(None, fallback_org_role="editor") == "contributor"


def test_can_upload_and_review_matrix():
    assert can_upload_evidence("contributor")
    assert can_upload_evidence("reviewer")
    assert not can_upload_evidence("auditor-viewer")
    assert not can_review_evidence("contributor")
    assert can_review_evidence("reviewer")


def test_evidence_in_pack_scope():
    accepted = EvidenceArtifact(org_id=uuid.uuid4(), framework="soc2", title="x", status="accepted")
    rejected = EvidenceArtifact(org_id=uuid.uuid4(), framework="soc2", title="x", status="rejected")
    assert evidence_in_pack_scope(accepted)
    assert not evidence_in_pack_scope(rejected)


def test_assert_evidence_readable_hides_rejected_from_auditor_viewer():
    row = EvidenceArtifact(org_id=uuid.uuid4(), framework="soc2", title="x", status="rejected")
    assert_evidence_readable(row, "reviewer")
    with pytest.raises(HTTPException) as exc:
        assert_evidence_readable(row, "auditor-viewer")
    assert exc.value.status_code == 404


def test_membership_evidence_role_from_db(db_session):
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    db_session.add(Org(id=org_id, name="Acme"))
    db_session.flush()
    db_session.add(
        User(id=user_id, org_id=org_id, email="viewer@acme.test", password_hash="x", role="viewer")
    )
    add_membership(db_session, user_id, org_id, "viewer")
    db_session.flush()
    membership = db_session.scalar(
        select(OrgMembership).where(OrgMembership.user_id == user_id)
    )
    membership.evidence_role = "contributor"
    db_session.flush()
    assert membership_evidence_role(db_session, user_id, org_id, fallback_org_role="viewer") == "contributor"


def test_require_evidence_upload_blocks_auditor_viewer(db_session):
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    db_session.add(Org(id=org_id, name="Acme"))
    db_session.flush()
    db_session.add(
        User(id=user_id, org_id=org_id, email="viewer@acme.test", password_hash="x", role="viewer")
    )
    add_membership(db_session, user_id, org_id, "viewer")
    db_session.flush()
    with pytest.raises(HTTPException) as exc:
        require_evidence_upload(db_session, user_id, org_id, org_role="viewer")
    assert exc.value.status_code == 403


def test_require_evidence_review_blocks_contributor(db_session):
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    db_session.add(Org(id=org_id, name="Acme"))
    db_session.flush()
    db_session.add(
        User(id=user_id, org_id=org_id, email="eng@acme.test", password_hash="x", role="editor")
    )
    add_membership(db_session, user_id, org_id, "editor")
    db_session.flush()
    with pytest.raises(HTTPException) as exc:
        require_evidence_review(db_session, user_id, org_id, org_role="editor")
    assert exc.value.status_code == 403
