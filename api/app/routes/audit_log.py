"""Admin audit log — read access to the org's privileged-action trail."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.rbac import require_min_role
from app.models import User
from app.services.org_activity import count_org_activity, list_org_activity

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


@router.get("", response_model=AuditLogPage)
def list_audit_log(
    limit: int = Query(default=25, ge=1, le=200),
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
