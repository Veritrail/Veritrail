import uuid
from datetime import date
from unittest.mock import MagicMock

from app.models.evidence_artifact import EvidenceArtifact
from app.services.evidence_artifact_supersession import supersede_prior_accepted


def test_supersede_prior_accepted_marks_older_rows():
    org_id = uuid.uuid4()
    new_id = uuid.uuid4()
    old = EvidenceArtifact(
        id=uuid.uuid4(),
        org_id=org_id,
        framework="soc2",
        composite_control_id="vulnerability_management",
        title="old scan",
        status="accepted",
        size_bytes=0,
    )
    new = EvidenceArtifact(
        id=new_id,
        org_id=org_id,
        framework="soc2",
        composite_control_id="vulnerability_management",
        title="new scan",
        status="accepted",
        size_bytes=0,
    )
    db = MagicMock()
    db.scalars.return_value.all.return_value = [old]

    count = supersede_prior_accepted(db, org_id=org_id, new_artifact=new)

    assert count == 1
    assert old.status == "superseded"
    assert old.superseded_by == new_id


def test_supersede_skips_when_not_accepted():
    row = EvidenceArtifact(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        framework="soc2",
        composite_control_id="vulnerability_management",
        title="pending",
        status="submitted",
        size_bytes=0,
    )
    db = MagicMock()
    assert supersede_prior_accepted(db, org_id=row.org_id, new_artifact=row) == 0
    db.scalars.assert_not_called()
