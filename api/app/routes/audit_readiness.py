"""Audit readiness narrative API — auditor-language assertions from shared PDF builder."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import current_principal
from app.services.audit_readiness import build_audit_readiness

router = APIRouter()

FRAMEWORKS = {"soc2", "cis_aws_l1", "iso27001"}


class AuditReadinessPlaybookItemOut(BaseModel):
    key: str
    check_ids: list[str]
    label: str
    status: str
    summary: str
    controls: list[str]
    sources: list[str]
    finding_count: int
    exception_count: int
    highest_severity: str | None = None
    applicability_reason: str | None = None
    action_kind: str | None = None
    action_label: str | None = None
    action_url: str | None = None


class AuditReadinessPlaybookOut(BaseModel):
    key: str
    label: str
    question: str
    outcome: str
    status: str
    items: list[AuditReadinessPlaybookItemOut]
    additional_action_count: int
    controls: list[str]
    narrative_domain_keys: list[str]


class AuditReadinessDomainOut(BaseModel):
    key: str
    label: str
    status: str
    assertion_text: str
    coverage_line: str
    verified_phrases: list[str]
    gaps: list[dict]
    exceptions: list[dict]
    control_tags: list[str]
    evidence_refs: list[str]
    checks_total: int
    checks_passing: int
    scope_note: str | None = None
    temporal_sentence: str | None = None
    named_sources: list[str] = Field(default_factory=list)
    check_ids: list[str] = Field(default_factory=list)


class AuditReadinessOut(BaseModel):
    framework: str
    org_name: str
    as_of: str
    period_days: int
    scope_label: str
    playbooks: list[AuditReadinessPlaybookOut]
    domains: list[AuditReadinessDomainOut]


@router.get("", response_model=AuditReadinessOut)
def get_audit_readiness(
    framework: str = Query(default="soc2"),
    period_days: int = Query(default=90, ge=7, le=365),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    if framework not in FRAMEWORKS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"framework must be one of {sorted(FRAMEWORKS)}",
        )
    return build_audit_readiness(
        db,
        uuid.UUID(p["org_id"]),
        framework,
        period_days=period_days,
    )
