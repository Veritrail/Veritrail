"""Supersede prior accepted external evidence when a newer artifact is accepted."""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.evidence_artifact import EvidenceArtifact


def supersede_prior_accepted(
    db: Session,
    *,
    org_id: uuid.UUID,
    new_artifact: EvidenceArtifact,
) -> int:
    """Mark older accepted artifacts for the same scope as superseded. Returns count updated."""
    if new_artifact.status != "accepted":
        return 0

    q = select(EvidenceArtifact).where(
        EvidenceArtifact.org_id == org_id,
        EvidenceArtifact.framework == new_artifact.framework,
        EvidenceArtifact.status == "accepted",
        EvidenceArtifact.id != new_artifact.id,
    )
    if new_artifact.composite_control_id:
        q = q.where(EvidenceArtifact.composite_control_id == new_artifact.composite_control_id)
    elif new_artifact.control_id:
        q = q.where(EvidenceArtifact.control_id == new_artifact.control_id)
    else:
        return 0

    if new_artifact.check_id:
        q = q.where(
            (EvidenceArtifact.check_id == new_artifact.check_id) | EvidenceArtifact.check_id.is_(None)
        )

    rows = db.scalars(q).all()
    count = 0
    for row in rows:
        row.status = "superseded"
        row.superseded_by = new_artifact.id
        count += 1
    return count
