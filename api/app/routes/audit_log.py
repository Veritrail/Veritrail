"""Admin audit log — read access to the org's privileged-action trail."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.rbac import require_min_role
from app.models import User
from app.services.org_activity import list_org_activity

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


@router.get("", response_model=list[AuditLogEntry])
def list_audit_log(
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(require_min_role("admin")),
    db: Session = Depends(get_db),
):
    """Recent privileged actions for the caller's org (admin+ only)."""
    return list_org_activity(db, user.org_id, limit=limit)
