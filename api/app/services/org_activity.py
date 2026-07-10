"""Append-only org workspace activity log (admin audit trail).

The org_activity_logs table + this writer existed but had no callers. Privileged
routes now record who-did-what-when here so the org has its own SOC 2
change-management evidence (CC6.1 / CC8.1). Read via list_org_activity.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.models import User
from app.models.org import Org
from app.models.org_team import OrgActivityLog

ActivationMilestone = Literal[
    "first_integration_at",
    "first_scan_completed_at",
    "first_finding_at",
]

_ACTIVATION_ACTIONS = {
    "first_integration_at": "integration.connected",
    "first_scan_completed_at": "activation.first_scan",
    "first_finding_at": "activation.first_finding",
}


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


def _duration_seconds_from_org_created(org: Org, at: datetime | None = None) -> int | None:
    created = org.created_at
    if not created:
        return None
    now = at or datetime.now(timezone.utc)
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return max(0, int((now - created).total_seconds()))


def record_activation_milestone(
    db: Session,
    org: Org,
    milestone: ActivationMilestone,
    *,
    detail: dict | None = None,
    actor_user_id: uuid.UUID | None = None,
) -> bool:
    """Set org.settings.activation[milestone] once; log with duration from org.created_at.

    Returns True when the milestone was newly recorded (idempotent thereafter).
    """
    settings = dict(org.settings or {})
    activation = dict(settings.get("activation") or {})
    if activation.get(milestone):
        return False

    now = datetime.now(timezone.utc)
    iso = now.isoformat()
    activation[milestone] = iso
    settings["activation"] = activation
    org.settings = settings
    flag_modified(org, "settings")

    duration = _duration_seconds_from_org_created(org, now)
    action = _ACTIVATION_ACTIONS.get(milestone, f"activation.{milestone}")
    d: dict[str, Any] = dict(detail or {})
    if duration is not None:
        d["duration_seconds"] = duration
    d["milestone"] = milestone
    d["at"] = iso
    log_org_activity(
        db,
        org_id=org.id,
        actor_user_id=actor_user_id,
        action=action,
        target_type="org",
        target_id=str(org.id),
        detail=d,
    )
    return True


def get_activation(org: Org) -> dict[str, Any]:
    """Ops-facing activation timestamps from org.settings."""
    settings = org.settings or {}
    activation = settings.get("activation") or {}
    return {
        "first_integration_at": activation.get("first_integration_at"),
        "first_scan_completed_at": activation.get("first_scan_completed_at"),
        "first_finding_at": activation.get("first_finding_at"),
        "org_created_at": org.created_at.isoformat() if org.created_at else None,
    }


def count_org_activity(db: Session, org_id: uuid.UUID | str) -> int:
    oid = org_id if isinstance(org_id, uuid.UUID) else uuid.UUID(str(org_id))
    return int(
        db.scalar(
            select(func.count())
            .select_from(OrgActivityLog)
            .where(OrgActivityLog.org_id == oid)
        )
        or 0
    )


def list_org_activity(
    db: Session,
    org_id: uuid.UUID | str,
    *,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """Recent activity for an org, newest first, joined to the actor's email."""
    oid = org_id if isinstance(org_id, uuid.UUID) else uuid.UUID(str(org_id))
    q = (
        select(OrgActivityLog, User.email)
        .outerjoin(User, User.id == OrgActivityLog.actor_user_id)
        .where(OrgActivityLog.org_id == oid)
        .order_by(OrgActivityLog.created_at.desc(), OrgActivityLog.id.desc())
        .offset(max(offset, 0))
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
