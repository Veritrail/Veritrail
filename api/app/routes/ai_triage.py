from __future__ import annotations

import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import current_principal
from app.models import Finding
from app.models.org import Org
from app.services.ai_finding_review import heuristic_triage_payload

router = APIRouter()


def _flag_enabled(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _org_ai_review_enabled(org: Org | None) -> bool:
    from app.services.ai_finding_review import org_ai_finding_review_enabled

    return org_ai_finding_review_enabled(org)


def _owned_finding(db: Session, p, finding_id: str) -> Finding:
    try:
        fid = uuid.UUID(finding_id)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid finding id") from e
    finding = db.get(Finding, fid)
    if not finding or str(finding.org_id) != p["org_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "finding not found")
    return finding


@router.get("/{finding_id}/triage")
def get_finding_triage(finding_id: str, p=Depends(current_principal), db: Session = Depends(get_db)):
    finding = _owned_finding(db, p, finding_id)
    org = db.get(Org, finding.org_id)
    enabled = _org_ai_review_enabled(org)
    return {
        "ai_triage_enabled": enabled,
        "result": heuristic_triage_payload(finding) if enabled else None,
    }


@router.post("/{finding_id}/triage")
def run_finding_triage(finding_id: str, p=Depends(current_principal), db: Session = Depends(get_db)):
    finding = _owned_finding(db, p, finding_id)
    org = db.get(Org, finding.org_id)
    enabled = _org_ai_review_enabled(org)
    return {
        "queued": False,
        "ai_triage_enabled": enabled,
        "result": heuristic_triage_payload(finding) if enabled else None,
    }
