"""Embed uploaded external evidence artifacts into audit evidence packs."""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.evidence_artifact import EvidenceArtifact
from app.services.evidence_artifact_storage import read_artifact_bytes


def _zip_segment(value: str | None, fallback: str = "unscoped") -> str:
    clean = re.sub(r"[^A-Za-z0-9._-]+", "-", (value or fallback).strip()).strip(".-")
    return (clean[:80] or fallback).lower()


def write_external_evidence_to_pack(
    db: Session,
    *,
    org_id: uuid.UUID,
    framework: str,
    write: Callable[[str, str | bytes], None],
) -> dict[str, Any]:
    """Write external-evidence/ tree into the pack. Returns summary for README/manifest."""
    rows = db.scalars(
        select(EvidenceArtifact)
        .where(
            EvidenceArtifact.org_id == org_id,
            EvidenceArtifact.framework == framework,
            EvidenceArtifact.status != "rejected",
        )
        .order_by(EvidenceArtifact.composite_control_id, EvidenceArtifact.created_at.desc())
    ).all()

    manifest: list[dict[str, Any]] = []
    files_written = 0

    for row in rows:
        group = _zip_segment(row.composite_control_id)
        entry: dict[str, Any] = {
            "id": str(row.id),
            "title": row.title,
            "framework": row.framework,
            "composite_control_id": row.composite_control_id,
            "control_ref": row.control_ref,
            "check_id": row.check_id,
            "source": row.source,
            "evidence_type": row.evidence_type,
            "status": row.status,
            "owner": row.owner,
            "external_url": row.external_url,
            "filename": row.filename,
            "content_type": row.content_type,
            "size_bytes": row.size_bytes,
            "checksum_sha256": row.checksum_sha256,
            "period_start": row.period_start.isoformat() if row.period_start else None,
            "period_end": row.period_end.isoformat() if row.period_end else None,
            "note": row.note,
            "review_notes": row.review_notes,
            "uploaded_at": row.created_at.isoformat() if row.created_at else None,
            "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
            "expires_at": row.expires_at.isoformat() if row.expires_at else None,
            "superseded_by": str(row.superseded_by) if row.superseded_by else None,
            "pack_file": None,
        }

        if row.storage_path:
            try:
                raw = read_artifact_bytes(row.storage_path)
                safe_name = _zip_segment(row.filename or "evidence", "evidence")
                pack_path = f"external-evidence/{group}/{row.id}_{safe_name}"
                write(pack_path, raw)
                entry["pack_file"] = pack_path
                files_written += 1
            except Exception:
                pass

        manifest.append(entry)

    write("external-evidence/manifest.json", json.dumps(manifest, indent=2, default=str))
    return {
        "artifact_count": len(manifest),
        "files_written": files_written,
        "accepted_count": sum(1 for r in rows if r.status == "accepted"),
        "submitted_count": sum(1 for r in rows if r.status == "submitted"),
    }
