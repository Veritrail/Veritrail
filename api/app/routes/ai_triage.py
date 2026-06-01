from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import current_principal
from app.models import Finding
from app.models.org import Org

router = APIRouter()


def _flag_enabled(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _org_ai_review_enabled(org: Org | None) -> bool:
    env_enabled = _flag_enabled(os.getenv("AI_TRIAGE_ENABLED"), default=False)
    if not org:
        return env_enabled
    settings = org.settings or {}
    features = settings.get("features") or {}
    if "ai_finding_review_enabled" in features:
        return bool(features.get("ai_finding_review_enabled"))
    if "ai_triage_enabled" in features:
        return bool(features.get("ai_triage_enabled"))
    return env_enabled


def _owned_finding(db: Session, p, finding_id: str) -> Finding:
    try:
        fid = uuid.UUID(finding_id)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid finding id") from e
    finding = db.get(Finding, fid)
    if not finding or str(finding.org_id) != p["org_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "finding not found")
    return finding


def _review_payload(finding: Finding) -> dict:
    evidence = finding.evidence or {}
    severity_weight = {
        "critical": 0.9,
        "high": 0.8,
        "medium": 0.58,
        "low": 0.38,
    }.get(finding.severity, 0.5)
    resource_count = evidence.get("resource_count") or evidence.get("affected_count") or 1
    try:
        resource_count = int(resource_count)
    except Exception:
        resource_count = 1
    confidence = min(0.96, severity_weight + (0.04 if resource_count > 1 else 0))

    if finding.severity in {"critical", "high"}:
        suggested_action = "resolve"
    elif finding.status == "excepted":
        suggested_action = "snooze"
    else:
        suggested_action = "review"

    rationale_bits = [
        f"{finding.severity.capitalize()} severity finding on {resource_count} resource{'s' if resource_count != 1 else ''}.",
        "Vigil recommends validating the resource context, then using remediation or Verify after fixing.",
    ]
    if finding.check_id.startswith("iam."):
        rationale_bits.append("Identity findings should be treated carefully because permission changes can affect workloads.")
    if finding.check_id.startswith("s3."):
        rationale_bits.append("Storage findings often have direct audit impact and should be fixed or exceptioned with evidence.")

    return {
        "id": f"heuristic-{finding.id}",
        "finding_id": str(finding.id),
        "confidence_score": round(confidence, 2),
        "rationale": " ".join(rationale_bits),
        "suggested_action": suggested_action,
        "model_version": "vigil-local-review-v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/{finding_id}/triage")
def get_finding_triage(finding_id: str, p=Depends(current_principal), db: Session = Depends(get_db)):
    finding = _owned_finding(db, p, finding_id)
    org = db.get(Org, finding.org_id)
    enabled = _org_ai_review_enabled(org)
    return {
        "ai_triage_enabled": enabled,
        "result": _review_payload(finding) if enabled else None,
    }


@router.post("/{finding_id}/triage")
def run_finding_triage(finding_id: str, p=Depends(current_principal), db: Session = Depends(get_db)):
    finding = _owned_finding(db, p, finding_id)
    org = db.get(Org, finding.org_id)
    enabled = _org_ai_review_enabled(org)
    return {
        "queued": False,
        "ai_triage_enabled": enabled,
        "result": _review_payload(finding) if enabled else None,
    }
