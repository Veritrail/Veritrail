"""Append-only org workspace activity log."""
from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.models.org_team import OrgActivityLog


def log_org_activity(
    db: Session,
    *,
    org_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    detail: dict | None = None,
) -> None:
    db.add(
        OrgActivityLog(
            org_id=org_id,
            actor_user_id=actor_user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            detail=detail or {},
        )
    )
