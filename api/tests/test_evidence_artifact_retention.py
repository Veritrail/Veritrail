import uuid
from datetime import date, datetime, timezone
from unittest.mock import MagicMock

from app.models.evidence_artifact import EvidenceArtifact
from app.services.evidence_artifact_retention import default_expires_at, run_evidence_artifact_retention


def test_default_expires_at_from_settings(monkeypatch):
    monkeypatch.setenv("EVIDENCE_ARTIFACTS_DEFAULT_EXPIRY_DAYS", "90")
    from app.core.config import get_settings

    get_settings.cache_clear()
    from datetime import timedelta

    assert default_expires_at() == date.today() + timedelta(days=90)
    get_settings.cache_clear()
    monkeypatch.delenv("EVIDENCE_ARTIFACTS_DEFAULT_EXPIRY_DAYS", raising=False)


def test_marks_accepted_artifact_expired(monkeypatch):
    monkeypatch.setenv("EVIDENCE_ARTIFACTS_RETENTION_DAYS", "0")
    from app.core.config import get_settings

    get_settings.cache_clear()
    row = EvidenceArtifact(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        framework="soc2",
        title="old",
        status="accepted",
        period_end=date(2020, 1, 1),
        size_bytes=0,
        created_at=datetime.now(timezone.utc),
    )
    db = MagicMock()
    db.scalars.return_value.all.side_effect = [[row], []]
    result = run_evidence_artifact_retention(db)
    assert result["expired_status"] == 1
    assert row.status == "expired"
    db.commit.assert_called_once()
