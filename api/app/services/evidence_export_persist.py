"""Shared evidence-pack build + EvidenceExport persistence (HTTP + worker)."""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import EvidenceExport
from app.services.evidence_pack import EvidencePackResult, build_evidence_pack


def _parse_vault_retain_until(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def build_and_persist_evidence_pack(
    db: Session,
    *,
    org_id: uuid.UUID,
    account_id: uuid.UUID,
    framework: str,
    period_days: int,
    as_of: datetime | None = None,
    created_by: uuid.UUID | None = None,
) -> tuple[EvidenceExport, EvidencePackResult]:
    """Build an evidence pack, upload to vault when configured, and record EvidenceExport.

    Caller owns the transaction commit. Returns the ORM row (flushed) and pack result.
    """
    pack = build_evidence_pack(
        db=db,
        org_id=org_id,
        account_id=account_id,
        framework=framework,
        period_days=period_days,
        as_of=as_of,
    )
    zip_bytes = pack.zip_bytes
    vault = pack.vault_upload if pack.vault_upload and pack.vault_upload.get("status") == "uploaded" else None
    zip_sha256 = hashlib.sha256(zip_bytes).hexdigest()
    row = EvidenceExport(
        org_id=org_id,
        account_id=account_id,
        framework=framework,
        period_days=period_days,
        as_of=as_of.date() if as_of else None,
        zip_sha256=zip_sha256,
        file_size_bytes=len(zip_bytes),
        report_id=pack.report_id,
        vault_s3_uri=vault.get("s3_uri") if vault else None,
        vault_version_id=vault.get("version_id") if vault else None,
        vault_object_lock_mode=vault.get("object_lock_mode") if vault else None,
        vault_retain_until=_parse_vault_retain_until(vault.get("retention_until") if vault else None),
        created_by=created_by,
    )
    db.add(row)
    db.flush()
    return row, pack
