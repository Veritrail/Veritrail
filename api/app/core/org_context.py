"""Resolve org from JWT principal, detecting stale org_id after DB restore."""
from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.org import Org, User

SESSION_STALE_MSG = "session stale — sign in again"


def resolve_org(db: Session, principal: dict) -> Org:
    """Look up org from JWT org_id; return 401 when token predates a DB restore."""
    try:
        jwt_org_id = uuid.UUID(principal["org_id"])
        user_id = uuid.UUID(principal["sub"])
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, SESSION_STALE_MSG) from exc

    org = db.get(Org, jwt_org_id)
    if org:
        return org

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user not found")

    if db.get(Org, user.org_id):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, SESSION_STALE_MSG)

    raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
