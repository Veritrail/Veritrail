"""Admin audit log — read access to the org's privileged-action trail."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.rbac import require_min_role
from app.models import User
from app.services.org_activity import count_org_activity, get_activation, list_org_activity

router = APIRouter()


class AuditLogEntry(BaseModel):
    id: str
    action: str
    actor_email: str | None = None
    target_type: str | None = None
    target_id: str | None = None
    target_label: str | None = None
    detail: dict = {}
    created_at: str | None = None


class AuditLogPage(BaseModel):
    items: list[AuditLogEntry]
    total: int
    offset: int
    limit: int


class ActivationOut(BaseModel):
    first_integration_at: str | None = None
    first_scan_completed_at: str | None = None
    first_finding_at: str | None = None
    org_created_at: str | None = None


@router.get("/activation", response_model=ActivationOut)
def get_org_activation(
    user: User = Depends(require_min_role("admin")),
    db: Session = Depends(get_db),
):
    """Ops-only activation milestones (time-to-first-result)."""
    from app.models.org import Org

    org = db.get(Org, user.org_id)
    if not org:
        return ActivationOut()
    return ActivationOut(**get_activation(org))


@router.get("", response_model=AuditLogPage)
def list_audit_log(
    limit: int = Query(default=15, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(require_min_role("admin")),
    db: Session = Depends(get_db),
):
    """Recent privileged actions for the caller's org (admin+ only)."""
    return AuditLogPage(
        items=list_org_activity(db, user.org_id, limit=limit, offset=offset),
        total=count_org_activity(db, user.org_id),
        offset=offset,
        limit=limit,
    )
