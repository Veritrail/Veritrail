"""Org-level SSO enforcement helpers."""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.org import Org, User
from app.models.user_session import UserSession

SSO_AUTH_METHODS = frozenset({"saml"})


def org_sso_required(org: Org | None) -> bool:
    if not org:
        return False
    security = (org.settings or {}).get("security") or {}
    return bool(security.get("sso_required"))


def is_sso_auth_method(method: str | None) -> bool:
    return (method or "").strip().lower() in SSO_AUTH_METHODS


def assert_password_auth_allowed(org: Org) -> None:
    if org_sso_required(org):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This workspace requires SSO sign-in — password authentication is disabled",
        )


def assert_session_allowed_for_org(org: Org, session: UserSession | None) -> None:
    if not org_sso_required(org):
        return
    if session is None or not is_sso_auth_method(session.auth_method):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "session ended — sign in again with SSO",
        )


def assert_password_auth_allowed_for_user(db: Session, user: User) -> None:
    org = db.get(Org, user.org_id)
    if org:
        assert_password_auth_allowed(org)
