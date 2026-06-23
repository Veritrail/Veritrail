"""Coarse org roles: owner > admin > editor > viewer."""
from __future__ import annotations

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import current_user_principal
from app.models.org import User
from app.models.org_team import ORG_ROLES

ROLE_RANK: dict[str, int] = {
    "viewer": 0,
    "editor": 1,
    "admin": 2,
    "owner": 3,
}

# Legacy SAML rows provisioned before default viewer role
_ROLE_ALIASES = {"member": "viewer"}


def normalize_role(role: str | None) -> str:
    if not role:
        return "viewer"
    r = role.lower().strip()
    if r in _ROLE_ALIASES:
        return _ROLE_ALIASES[r]
    if r not in ORG_ROLES:
        return "viewer"
    return r


def role_rank(role: str | None) -> int:
    return ROLE_RANK.get(normalize_role(role), 0)


def role_at_least(role: str | None, minimum: str) -> bool:
    return role_rank(role) >= role_rank(minimum)


def can_manage_members(role: str | None) -> bool:
    return normalize_role(role) == "owner"


def can_mutate_integrations(role: str | None) -> bool:
    return role_at_least(role, "admin")


def can_export_evidence(role: str | None) -> bool:
    return role_at_least(role, "admin")


def can_triage_findings(role: str | None) -> bool:
    return role_at_least(role, "editor")


def get_org_user(db: Session, principal: dict) -> User:
    user = db.get(User, principal["sub"])
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user not found")
    if str(user.org_id) != principal.get("org_id"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "org mismatch")
    return user


def current_org_user(
    p=Depends(current_user_principal),
    db: Session = Depends(get_db),
) -> User:
    return get_org_user(db, p)


def require_min_role(minimum: str):
    def _dep(user: User = Depends(current_org_user)) -> User:
        if not role_at_least(user.role, minimum):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"This action requires {minimum} role or higher",
            )
        return user

    return _dep


def require_owner():
    return require_min_role("owner")
