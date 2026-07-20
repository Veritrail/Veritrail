"""Unit + DB integration tests for capability coverage snapshot retention."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from sqlalchemy import select

from app.models.capability_coverage import CapabilityCoverageSnapshot
from app.models.org import Org
from app.services.capability_snapshot_retention import (
    DEFAULT_BATCH_SIZE,
    run_capability_snapshot_retention,
)


def _clear_settings(monkeypatch, days: str):
    monkeypatch.setenv("CAPABILITY_SNAPSHOT_RETENTION_DAYS", days)
    from app.core.config import get_settings

    get_settings.cache_clear()
    return get_settings


def test_unlimited_retention_skips_deletes(monkeypatch):
    _clear_settings(monkeypatch, "0")
    oldest = datetime(2024, 1, 1, tzinfo=timezone.utc)
    db = MagicMock()
    db.scalar.return_value = oldest

    with patch("app.services.capability_snapshot_retention.delete") as mock_delete:
        result = run_capability_snapshot_retention(db)

    assert result["deleted"] == 0
    assert result["retention_days"] == 0
    assert result["oldest_retained_at"] == oldest.isoformat()
    mock_delete.assert_not_called()
    db.execute.assert_not_called()
    db.commit.assert_not_called()
    _clear_settings(monkeypatch, "400")


def test_deletes_old_rows_in_bounded_batches(monkeypatch):
    _clear_settings(monkeypatch, "30")
    old_ids = [uuid.uuid4(), uuid.uuid4()]
    retained_at = datetime.now(timezone.utc) - timedelta(days=5)

    db = MagicMock()
    # First batch returns two ids; second batch is empty (done).
    db.scalars.return_value.all.side_effect = [old_ids, []]
    db.execute.return_value.rowcount = 2
    db.scalar.return_value = retained_at

    result = run_capability_snapshot_retention(db, batch_size=DEFAULT_BATCH_SIZE)

    assert result["deleted"] == 2
    assert result["retention_days"] == 30
    assert result["oldest_retained_at"] == retained_at.isoformat()
    db.execute.assert_called_once()
    db.commit.assert_called_once()
    _clear_settings(monkeypatch, "400")


def test_rerun_is_safe_when_nothing_left(monkeypatch):
    _clear_settings(monkeypatch, "400")
    retained_at = datetime.now(timezone.utc) - timedelta(days=10)
    db = MagicMock()
    db.scalars.return_value.all.return_value = []
    db.scalar.return_value = retained_at

    result = run_capability_snapshot_retention(db)

    assert result["deleted"] == 0
    assert result["oldest_retained_at"] == retained_at.isoformat()
    db.execute.assert_not_called()
    db.commit.assert_not_called()
    _clear_settings(monkeypatch, "400")


def test_prune_snapshots_against_db(db_session, monkeypatch):
    """Real Postgres: old snapshots pruned, recent retained, job is idempotent."""
    _clear_settings(monkeypatch, "40")
    # Fixture wraps work in an outer transaction; map commit → flush so batches
    # stay visible without ending the rollback-on-teardown transaction.
    monkeypatch.setattr(db_session, "commit", db_session.flush)

    org = Org(name="Retention Org", slug=f"ret-{uuid.uuid4().hex[:8]}")
    db_session.add(org)
    db_session.flush()

    now = datetime.now(timezone.utc)
    old = CapabilityCoverageSnapshot(
        id=uuid.uuid4(),
        org_id=org.id,
        payload_json={"lane": "old"},
        taken_at=now - timedelta(days=100),
    )
    recent = CapabilityCoverageSnapshot(
        id=uuid.uuid4(),
        org_id=org.id,
        payload_json={"lane": "recent"},
        taken_at=now - timedelta(days=5),
    )
    db_session.add_all([old, recent])
    db_session.flush()

    first = run_capability_snapshot_retention(db_session, batch_size=10)
    assert first["deleted"] == 1
    assert first["retention_days"] == 40
    assert first["oldest_retained_at"] is not None

    remaining = db_session.scalars(
        select(CapabilityCoverageSnapshot).where(CapabilityCoverageSnapshot.org_id == org.id)
    ).all()
    assert len(remaining) == 1
    assert remaining[0].id == recent.id

    second = run_capability_snapshot_retention(db_session, batch_size=10)
    assert second["deleted"] == 0
    assert second["oldest_retained_at"] is not None

    _clear_settings(monkeypatch, "400")
