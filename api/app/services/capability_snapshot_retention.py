"""Prune aged capability coverage snapshots under a configurable retention window."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.capability_coverage import CapabilityCoverageSnapshot

# Bounded delete size so a long backlog cannot lock the table indefinitely.
DEFAULT_BATCH_SIZE = 500


def _oldest_retained_at(db: Session) -> datetime | None:
    return db.scalar(select(func.min(CapabilityCoverageSnapshot.taken_at)))


def run_capability_snapshot_retention(
    db: Session,
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> dict:
    """Delete capability_coverage_snapshots older than CAPABILITY_SNAPSHOT_RETENTION_DAYS.

    Returns deleted count and the oldest remaining taken_at (ISO UTC or None).
    Safe to rerun. When retention days is 0 (unlimited), performs no deletes.
    """
    retention_days = int(get_settings().CAPABILITY_SNAPSHOT_RETENTION_DAYS)
    if retention_days <= 0:
        oldest = _oldest_retained_at(db)
        return {
            "deleted": 0,
            "oldest_retained_at": oldest.isoformat() if oldest else None,
            "retention_days": retention_days,
        }

    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    deleted = 0
    limit = max(1, int(batch_size))

    while True:
        ids = list(
            db.scalars(
                select(CapabilityCoverageSnapshot.id)
                .where(CapabilityCoverageSnapshot.taken_at < cutoff)
                .order_by(CapabilityCoverageSnapshot.taken_at.asc())
                .limit(limit)
            ).all()
        )
        if not ids:
            break
        result = db.execute(
            delete(CapabilityCoverageSnapshot).where(CapabilityCoverageSnapshot.id.in_(ids))
        )
        batch_deleted = int(result.rowcount or 0)
        if batch_deleted <= 0:
            # Defensive: avoid an infinite loop if the driver reports 0 rowcount.
            break
        deleted += batch_deleted
        db.commit()

    oldest = _oldest_retained_at(db)
    return {
        "deleted": deleted,
        "oldest_retained_at": oldest.isoformat() if oldest else None,
        "retention_days": retention_days,
    }
