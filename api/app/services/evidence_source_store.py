"""Persist workspace evidence-source registry in Postgres (with settings JSON backfill)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.evidence_source import EvidenceSource
from app.models.org import Org
from app.services.evidence_source_registry import EVIDENCE_SOURCE_CATEGORIES, get_evidence_sources, merge_evidence_sources

_VALID_KEYS = {c["key"] for c in EVIDENCE_SOURCE_CATEGORIES}


def _row_to_entry(row: EvidenceSource) -> dict[str, Any]:
    return {
        "vendor": row.vendor,
        "owner": row.owner,
        "cadence": row.cadence,
        "scope_description": row.scope_description,
        "source_type": row.source_type,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "updated_by_user_id": str(row.updated_by_user_id) if row.updated_by_user_id else None,
    }


def _import_settings_json(db: Session, org: Org) -> dict[str, dict[str, Any]]:
    """One-time import from org.settings.evidence_sources into evidence_sources rows."""
    legacy = get_evidence_sources(org.settings)
    if not legacy:
        return {}
    now = datetime.now(timezone.utc)
    for key, entry in legacy.items():
        if key not in _VALID_KEYS:
            continue
        row = EvidenceSource(
            org_id=org.id,
            category_key=key,
            vendor=entry["vendor"],
            owner=entry.get("owner"),
            cadence=entry.get("cadence"),
            scope_description=entry.get("scope_description"),
            source_type=entry.get("source_type"),
            updated_by_user_id=uuid.UUID(entry["updated_by_user_id"])
            if entry.get("updated_by_user_id")
            else None,
            updated_at=now,
        )
        db.add(row)
    settings = dict(org.settings or {})
    settings.pop("evidence_sources", None)
    org.settings = settings
    db.add(org)
    db.flush()
    return legacy


def load_evidence_sources(db: Session, org_id: uuid.UUID) -> dict[str, dict[str, Any]]:
    rows = db.scalars(select(EvidenceSource).where(EvidenceSource.org_id == org_id)).all()
    if rows:
        return {row.category_key: _row_to_entry(row) for row in rows if row.vendor}
    org = db.get(Org, org_id)
    if not org:
        return {}
    return _import_settings_json(db, org)


def apply_evidence_source_updates(
    db: Session,
    org_id: uuid.UUID,
    updates: dict[str, dict[str, Any]],
    *,
    user_id: str | None = None,
) -> dict[str, dict[str, Any]]:
    """Upsert category entries; empty vendor removes the row."""
    load_evidence_sources(db, org_id)
    now = datetime.now(timezone.utc)
    actor_id = uuid.UUID(user_id) if user_id else None
    existing = {
        row.category_key: row
        for row in db.scalars(select(EvidenceSource).where(EvidenceSource.org_id == org_id)).all()
    }

    for key, patch in updates.items():
        if key not in _VALID_KEYS:
            continue
        vendor = (patch.get("vendor") or "").strip()
        if not vendor:
            if key in existing:
                db.delete(existing[key])
            continue
        row = existing.get(key) or EvidenceSource(org_id=org_id, category_key=key)
        row.vendor = vendor[:120]
        for field in ("owner", "cadence", "scope_description", "source_type"):
            if field in patch:
                val = patch.get(field)
                trimmed = (val or "").strip()
                setattr(row, field, trimmed[:500] if field == "scope_description" else trimmed[:80] or None)
        row.updated_at = now
        row.updated_by_user_id = actor_id
        db.add(row)

    db.flush()
    return load_evidence_sources(db, org_id)


def evidence_sources_for_export_db(db: Session, org_id: uuid.UUID) -> dict[str, Any]:
    from app.services.evidence_source_registry import evidence_sources_for_export

    sources = load_evidence_sources(db, org_id)
    return evidence_sources_for_export({"evidence_sources": sources})


def merge_evidence_sources_settings(
    stored: dict | None,
    updates: dict[str, dict[str, Any]],
    *,
    user_id: str | None = None,
) -> dict[str, dict[str, Any]]:
    """Legacy JSON merge — used by unit tests and settings backfill."""
    return merge_evidence_sources(stored, updates, user_id=user_id)
