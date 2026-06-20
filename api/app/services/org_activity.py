"""Append-only org workspace activity log (admin audit trail).

The org_activity_logs table + this writer existed but had no callers. Privileged
routes now record who-did-what-when here so the org has its own SOC 2
change-management evidence (CC6.1 / CC8.1). Read via list_org_activity.
"""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User
from app.models.org_team import OrgActivityLog


def log_org_activity(
    db: Session,
    *,
    org_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    target_label: str | None = None,
    actor_email: str | None = None,
    detail: dict | None = None,
) -> OrgActivityLog:
    """Append one audit row to the caller's session (commits with the action).

    actor_email / target_label are denormalized into `detail` so the record
    stays readable after the user or target row is deleted (FKs are SET NULL).
    """
    d: dict[str, Any] = dict(detail or {})
    if actor_email:
        d.setdefault("actor_email", actor_email)
    if target_label:
        d.setdefault("target_label", target_label)
    entry = OrgActivityLog(
        org_id=org_id,
        actor_user_id=actor_user_id,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        detail=d,
    )
    db.add(entry)
    return entry


def log_org_activity_for_actor(
    db: Session,
    *,
    actor: User,
    action: str,
    target_type: str | None = None,
    target_id: Any = None,
    target_label: str | None = None,
    detail: dict | None = None,
) -> OrgActivityLog:
    """Convenience wrapper when the route already has the acting User."""
    return log_org_activity(
        db,
        org_id=actor.org_id,
        actor_user_id=actor.id,
        actor_email=actor.email,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        target_label=target_label,
        detail=detail,
    )


def list_org_activity(
    db: Session,
    org_id: uuid.UUID | str,
    *,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Recent activity for an org, newest first, joined to the actor's email."""
    oid = org_id if isinstance(org_id, uuid.UUID) else uuid.UUID(str(org_id))
    q = (
        select(OrgActivityLog, User.email)
        .outerjoin(User, User.id == OrgActivityLog.actor_user_id)
        .where(OrgActivityLog.org_id == oid)
        .order_by(OrgActivityLog.created_at.desc(), OrgActivityLog.id.desc())
        .limit(min(max(limit, 1), 200))
    )
    out: list[dict[str, Any]] = []
    for entry, email in db.execute(q).all():
        detail = entry.detail or {}
        out.append(
            {
                "id": str(entry.id),
                "action": entry.action,
                "actor_email": email or detail.get("actor_email"),
                "target_type": entry.target_type,
                "target_id": entry.target_id,
                "target_label": detail.get("target_label"),
                "detail": {k: v for k, v in detail.items() if k not in ("actor_email", "target_label")},
                "created_at": entry.created_at.isoformat() if entry.created_at else None,
            }
        )
    return out
