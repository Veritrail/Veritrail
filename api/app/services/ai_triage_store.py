"""Persist triage results (local heuristic or LLM)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models import Finding
from app.models.ai_triage import AITriageResult


def save_triage_result(
    db: Session,
    finding: Finding,
    *,
    confidence_score: float,
    rationale: str,
    suggested_action: str,
    model_version: str,
    findings_context: dict[str, Any] | None = None,
) -> AITriageResult:
    row = AITriageResult(
        id=uuid.uuid4(),
        finding_id=finding.id,
        confidence_score=confidence_score,
        rationale=rationale,
        suggested_action=suggested_action,
        findings_context=findings_context,
        model_version=model_version,
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def triage_row_to_api(row: AITriageResult) -> dict:
    return {
        "id": str(row.id),
        "finding_id": str(row.finding_id),
        "confidence_score": row.confidence_score,
        "rationale": row.rationale,
        "suggested_action": row.suggested_action,
        "model_version": row.model_version,
        "created_at": row.created_at,
    }
