"""Team invite helpers."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.org import Org, User
from app.models.org_team import ORG_ROLES, OrgInvite


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def new_invite_token() -> str:
    return uuid.uuid4().hex + uuid.uuid4().hex


def pending_invite_for_email(db: Session, email: str) -> OrgInvite | None:
    now = datetime.now(timezone.utc)
    return db.scalar(
        select(OrgInvite).where(
            OrgInvite.email == _normalize_email(email),
            OrgInvite.status == "pending",
            or_(OrgInvite.expires_at.is_(None), OrgInvite.expires_at > now),
        )
    )


def get_valid_invite(db: Session, token: str, email: str | None = None) -> OrgInvite:
    invite = db.scalar(select(OrgInvite).where(OrgInvite.token == token, OrgInvite.status == "pending"))
    if not invite:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite not found or already used")
    now = datetime.now(timezone.utc)
    if invite.expires_at is not None and invite.expires_at <= now:
        raise HTTPException(status.HTTP_410_GONE, "Invite has expired")
    if email and _normalize_email(email) != _normalize_email(invite.email):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email does not match this invite")
    if invite.role not in ORG_ROLES:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Invalid invite role")
    return invite


def accept_invite_for_new_user(db: Session, invite: OrgInvite) -> None:
    invite.status = "accepted"
    invite.accepted_at = datetime.now(timezone.utc)


def ensure_can_invite_role(inviter: User, target_role: str) -> None:
    if target_role not in ORG_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"role must be one of: {', '.join(sorted(ORG_ROLES))}")
    if target_role == "owner":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot invite as owner — transfer ownership instead")
    inviter_role = inviter.role or "viewer"
    if inviter_role != "owner" and target_role in ("admin", "owner"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only owners can invite admins")


def ensure_email_invitable(db: Session, org: Org, email: str) -> None:
    normalized = _normalize_email(email)
    existing = db.scalar(select(User).where(User.email == normalized))
    if existing:
        if existing.org_id == org.id:
            raise HTTPException(status.HTTP_409_CONFLICT, "User is already a member of this workspace")
        raise HTTPException(status.HTTP_409_CONFLICT, "Email is registered to another workspace")

    pending = db.scalar(
        select(OrgInvite).where(
            OrgInvite.org_id == org.id,
            OrgInvite.email == normalized,
            OrgInvite.status == "pending",
        )
    )
    if pending:
        raise HTTPException(status.HTTP_409_CONFLICT, "Pending invite already exists for this email")


def create_invite(
    db: Session,
    *,
    org: Org,
    email: str,
    role: str,
    invited_by: uuid.UUID,
    expiry_days: int | None = None,
) -> OrgInvite:
    ensure_email_invitable(db, org, email)
    expires_at = None if expiry_days is None else datetime.now(timezone.utc) + timedelta(days=expiry_days)
    invite = OrgInvite(
        org_id=org.id,
        email=_normalize_email(email),
        role=role,
        token=new_invite_token(),
        status="pending",
        expires_at=expires_at,
        invited_by=invited_by,
    )
    db.add(invite)
    return invite


def block_signup_without_invite_when_pending(db: Session, email: str) -> None:
    pending = pending_invite_for_email(db, email)
    if pending:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "You have a pending workspace invite — open the link from your email to join",
        )


def consume_invite_for_signup(db: Session, invite_token: str, email: str) -> tuple[Org, str]:
    invite = get_valid_invite(db, invite_token, email=email)
    org = db.get(Org, invite.org_id)
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "workspace not found")
    invite.status = "accepted"
    invite.accepted_at = datetime.now(timezone.utc)
    return org, invite.role


def provision_sso_user(
    db: Session,
    *,
    email: str,
    password_hash: str = "",
    **identity_fields,
) -> tuple[User, bool]:
    """Create or return user. Pending invite joins existing org; else new org if allowed."""
    from app.core.config import get_settings

    normalized = _normalize_email(email)
    existing = db.scalar(select(User).where(User.email == normalized))
    if existing:
        for key, value in identity_fields.items():
            if value and not getattr(existing, key, None):
                setattr(existing, key, value)
        return existing, False

    pending = pending_invite_for_email(db, normalized)
    if pending:
        org = db.get(Org, pending.org_id)
        if not org:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "workspace not found")
        user = User(
            id=uuid.uuid4(),
            org_id=org.id,
            email=normalized,
            password_hash=password_hash,
            role=pending.role,
            **identity_fields,
        )
        pending.status = "accepted"
        pending.accepted_at = datetime.now(timezone.utc)
        db.add(user)
        return user, True

    if not get_settings().ALLOW_SSO_SIGNUP:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "no_account_for_idp")

    from app.services.org_domain import assert_domain_available_for_new_workspace

    assert_domain_available_for_new_workspace(db, normalized)

    from app.services.org_provision import unique_org_slug

    org_name = normalized.split("@")[0] or "Workspace"
    org = Org(id=uuid.uuid4(), name=org_name, slug=unique_org_slug(db, org_name))
    user = User(
        id=uuid.uuid4(),
        org_id=org.id,
        email=normalized,
        password_hash=password_hash,
        role="owner",
        **identity_fields,
    )
    db.add_all([org, user])
    return user, True

