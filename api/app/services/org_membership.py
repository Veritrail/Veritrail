"""Workspace membership helpers."""
from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.org import Org, User
from app.models.org_team import OrgMembership


def list_memberships(db: Session, user_id: uuid.UUID) -> list[tuple[OrgMembership, Org]]:
    rows = db.execute(
        select(OrgMembership, Org)
        .join(Org, Org.id == OrgMembership.org_id)
        .where(OrgMembership.user_id == user_id)
        .order_by(Org.name)
    ).all()
    return list(rows)


def get_membership(db: Session, user_id: uuid.UUID, org_id: uuid.UUID) -> OrgMembership | None:
    return db.scalar(
        select(OrgMembership).where(
            OrgMembership.user_id == user_id,
            OrgMembership.org_id == org_id,
        )
    )


def membership_role_for(db: Session, user_id: uuid.UUID, org_id: uuid.UUID) -> str | None:
    membership = get_membership(db, user_id, org_id)
    return membership.role if membership else None


def add_membership(
    db: Session,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    role: str,
) -> OrgMembership:
    existing = get_membership(db, user_id, org_id)
    if existing:
        return existing
    membership = OrgMembership(
        id=uuid.uuid4(),
        user_id=user_id,
        org_id=org_id,
        role=role,
    )
    db.add(membership)
    return membership


def set_active_workspace(db: Session, user: User, org_id: uuid.UUID) -> None:
    # SessionLocal uses autoflush=False — flush so a just-added membership is visible.
    db.flush()
    membership = get_membership(db, user.id, org_id)
    if not membership:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not a member of this workspace")
    user.org_id = org_id
    user.role = membership.role
