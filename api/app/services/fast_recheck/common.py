"""Shared helpers for fast finding verification."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models import Finding, FindingEvent


def now() -> datetime:
    return datetime.now(timezone.utc)


def resolve_finding(db: Session, finding: Finding, *, actor: str, note: str) -> dict[str, Any]:
    finding.status = "resolved"
    finding.resolved_at = now()
    db.add(FindingEvent(id=uuid.uuid4(), finding_id=finding.id, action="resolved", actor=actor, note=note))
    db.commit()
    return {
        "queued": False,
        "checked": True,
        "resolved": True,
        "finding_id": str(finding.id),
        "check_id": finding.check_id,
    }


def unchanged(*, reason: str = "resource_still_failing", error: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"queued": False, "checked": True, "resolved": False, "reason": reason}
    if error:
        out["error"] = error
    return out


def unsupported() -> dict[str, Any]:
    return {"checked": False, "resolved": False}


def resource_region(finding: Finding) -> str:
    evidence = finding.evidence or {}
    if evidence.get("region"):
        return str(evidence["region"])
    parts = (finding.resource_arn or "").split(":")
    if len(parts) > 3 and parts[3]:
        return parts[3]
    return "us-east-1"


def evidence_str(finding: Finding, *keys: str) -> str | None:
    evidence = finding.evidence or {}
    for key in keys:
        value = evidence.get(key)
        if value:
            return str(value)
    return None


def arn_resource_id(finding: Finding, *, marker: str, tail_index: int = -1) -> str | None:
    arn = finding.resource_arn or ""
    if marker in arn:
        return arn.split(marker, 1)[-1].split("/")[-1]
    parts = arn.split("/")
    if parts:
        return parts[tail_index]
    return None


def s3_bucket_name(finding: Finding) -> str | None:
    name = evidence_str(finding, "bucket_name")
    if name:
        return name
    arn = finding.resource_arn or ""
    if arn.startswith("arn:aws:s3:::"):
        return arn.removeprefix("arn:aws:s3:::")
    if ":s3:::" in arn:
        return arn.split(":::", 1)[-1]
    return None
