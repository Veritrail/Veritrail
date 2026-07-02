"""Tests for evidence artifact comment API."""
from __future__ import annotations

import uuid

from app.models.evidence_artifact import EvidenceArtifact
from app.models.evidence_artifact_comment import EvidenceArtifactComment
from app.models.org import Org, User


def test_evidence_artifact_comment_persists(db_session):
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    db_session.add(Org(id=org_id, name="Acme"))
    db_session.flush()
    db_session.add(User(id=user_id, org_id=org_id, email=f"eng-{user_id}@acme.test", password_hash="x", role="admin"))
    art = EvidenceArtifact(org_id=org_id, framework="soc2", title="EDR report", status="submitted")
    db_session.add(art)
    db_session.flush()

    comment = EvidenceArtifactComment(
        org_id=org_id,
        artifact_id=art.id,
        user_id=user_id,
        body="Please confirm quarterly review date.",
    )
    db_session.add(comment)
    db_session.flush()

    rows = (
        db_session.query(EvidenceArtifactComment)
        .filter(EvidenceArtifactComment.artifact_id == art.id)
        .order_by(EvidenceArtifactComment.created_at.asc())
        .all()
    )
    assert len(rows) == 1
    assert rows[0].body == "Please confirm quarterly review date."


def test_evidence_artifact_comment_delete_by_author(db_session):
    org_id = uuid.uuid4()
    author_id = uuid.uuid4()
    db_session.add(Org(id=org_id, name="Acme"))
    db_session.flush()
    db_session.add(
        User(id=author_id, org_id=org_id, email="author@acme.test", password_hash="x", role="editor")
    )
    art = EvidenceArtifact(org_id=org_id, framework="soc2", title="EDR report", status="submitted")
    db_session.add(art)
    db_session.flush()

    comment = EvidenceArtifactComment(
        org_id=org_id,
        artifact_id=art.id,
        user_id=author_id,
        body="Typo in the title.",
    )
    db_session.add(comment)
    db_session.flush()

    db_session.delete(comment)
    db_session.flush()

    remaining = (
        db_session.query(EvidenceArtifactComment)
        .filter(EvidenceArtifactComment.artifact_id == art.id)
        .all()
    )
    assert remaining == []
