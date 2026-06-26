"""Expire and optionally purge uploaded external evidence artifacts."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.evidence_artifact import EvidenceArtifact
from app.services.evidence_artifact_storage import delete_artifact


def default_expires_at() -> date | None:
    days = get_settings().EVIDENCE_ARTIFACTS_DEFAULT_EXPIRY_DAYS
    if days <= 0:
        return None
    return date.today() + timedelta(days=days)


def run_evidence_artifact_retention(db: Session) -> dict[str, int]:
    today = date.today()
    expired_status = 0
    purged = 0

    rows = db.scalars(
        select(EvidenceArtifact).where(EvidenceArtifact.status.in_(("submitted", "accepted")))
    ).all()
    for row in rows:
        stale_on = row.expires_at or row.period_end
        if stale_on and stale_on < today:
            row.status = "expired"
            expired_status += 1

    retention_days = get_settings().EVIDENCE_ARTIFACTS_RETENTION_DAYS
    if retention_days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        purge_rows = db.scalars(
            select(EvidenceArtifact).where(
                EvidenceArtifact.status.in_(("rejected", "expired", "superseded")),
                EvidenceArtifact.created_at < cutoff,
            )
        ).all()
        for row in purge_rows:
            if row.storage_path:
                delete_artifact(row.storage_path)
            db.delete(row)
            purged += 1

    if expired_status or purged:
        db.commit()
    return {"expired_status": expired_status, "purged": purged}
