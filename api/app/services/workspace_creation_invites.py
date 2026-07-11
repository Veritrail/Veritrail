"""Platform-admin workspace creation invite helpers."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.data.plans import PLAN_TIERS, _LEGACY_ALIASES
from app.models.org import Org, User
from app.models.platform_audit import PlatformAuditLog
from app.models.workspace_creation_invite import WorkspaceCreationInvite
from app.services.org_invites import new_invite_token
from app.services.org_provision import unique_org_slug

VALID_PLANS = frozenset(PLAN_TIERS.keys()) | frozenset(_LEGACY_ALIASES.keys())

DEFAULT_EXPIRY_DAYS = 7
ALLOWED_EXPIRY_DAYS = frozenset({1, 7})
MAX_EXPIRY_HOURS = 72


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def normalize_plan(plan: str) -> str:
    p = (plan or "trial").strip().lower()
    if p not in VALID_PLANS:
        raise ValueError(f"plan must be one of: {', '.join(sorted(PLAN_TIERS.keys()))}")
    return _LEGACY_ALIASES.get(p, p)


def normalize_plan_or_http(plan: str) -> str:
    try:
        return normalize_plan(plan)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


def pending_workspace_invite_for_email(db: Session, email: str) -> WorkspaceCreationInvite | None:
    now = datetime.now(timezone.utc)
    return db.scalar(
        select(WorkspaceCreationInvite).where(
            WorkspaceCreationInvite.email == _normalize_email(email),
            WorkspaceCreationInvite.status == "pending",
            or_(
                WorkspaceCreationInvite.expires_at.is_(None),
                WorkspaceCreationInvite.expires_at > now,
            ),
        )
    )


def is_workspace_creation_invite_token(db: Session, token: str) -> bool:
    return bool(
        db.scalar(
            select(WorkspaceCreationInvite.id).where(
                WorkspaceCreationInvite.token == token,
                WorkspaceCreationInvite.status == "pending",
            )
        )
    )


def get_valid_workspace_invite(
    db: Session, token: str, email: str | None = None
) -> WorkspaceCreationInvite:
    invite = db.scalar(
        select(WorkspaceCreationInvite).where(
            WorkspaceCreationInvite.token == token,
            WorkspaceCreationInvite.status == "pending",
        )
    )
    if not invite:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite not found or already used")
    now = datetime.now(timezone.utc)
    if invite.expires_at is not None and invite.expires_at <= now:
        raise HTTPException(status.HTTP_410_GONE, "Invite has expired")
    if email and _normalize_email(email) != _normalize_email(invite.email):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email does not match this invite")
    return invite


def ensure_email_can_receive_workspace_invite(db: Session, email: str) -> None:
    normalized = _normalize_email(email)
    if db.scalar(select(User).where(User.email == normalized)):
        raise HTTPException(status.HTTP_409_CONFLICT, "A user with this email already exists")
    if pending_workspace_invite_for_email(db, normalized):
        raise HTTPException(status.HTTP_409_CONFLICT, "A pending workspace invite already exists for this email")


def _invite_expires_at(*, expiry_days: int, expiry_hours: int | None) -> datetime:
    now = datetime.now(timezone.utc)
    if expiry_hours is not None:
        return now + timedelta(hours=expiry_hours)
    return now + timedelta(days=expiry_days)


def create_workspace_invite(
    db: Session,
    *,
    email: str,
    org_name: str | None,
    plan: str,
    created_by: uuid.UUID,
    expiry_days: int = DEFAULT_EXPIRY_DAYS,
    expiry_hours: int | None = None,
) -> WorkspaceCreationInvite:
    ensure_email_can_receive_workspace_invite(db, email)
    suggested_name = (org_name or "").strip() or None
    invite = WorkspaceCreationInvite(
        email=_normalize_email(email),
        org_name=suggested_name,
        plan=normalize_plan(plan),
        token=new_invite_token(),
        status="pending",
        expires_at=_invite_expires_at(expiry_days=expiry_days, expiry_hours=expiry_hours),
        created_by=created_by,
    )
    db.add(invite)
    return invite


def provision_org_from_workspace_invite(
    db: Session,
    invite: WorkspaceCreationInvite,
    *,
    org_name_override: str = "",
) -> Org:
    name = org_name_override.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Workspace name is required")
    org = Org(
        id=uuid.uuid4(),
        name=name,
        slug=unique_org_slug(db, name),
        plan=invite.plan,
    )
    invite.status = "accepted"
    invite.accepted_at = datetime.now(timezone.utc)
    invite.created_org_id = org.id
    db.add(org)
    return org


def audit_workspace_invite_accepted(
    db: Session,
    *,
    invite: WorkspaceCreationInvite,
    org: Org,
    user: User,
    source: str,
    request: Request | None = None,
) -> None:
    from app.core.client_ip import client_ip_from_request

    invited_by_email = None
    if invite.created_by:
        inviter = db.get(User, invite.created_by)
        invited_by_email = inviter.email if inviter else None

    db.add(
        PlatformAuditLog(
            actor_user_id=user.id,
            actor_email=user.email,
            action="platform_admin.workspace_invite_accepted",
            method=request.method if request else "POST",
            endpoint=request.url.path if request else "/v1/auth/signup",
            source_ip=client_ip_from_request(request) if request else None,
            allowed=True,
            detail={
                "invite_id": str(invite.id),
                "invited_email": invite.email,
                "accepted_email": user.email,
                "workspace_name": org.name,
                "org_id": str(org.id),
                "plan": invite.plan,
                "invited_by_user_id": str(invite.created_by) if invite.created_by else None,
                "invited_by_email": invited_by_email,
                "accepted_at": invite.accepted_at.isoformat() if invite.accepted_at else None,
                "source": source,
            },
        )
    )


def consume_workspace_creation_invite_for_signup(
    db: Session,
    invite_token: str,
    email: str,
    *,
    org_name: str = "",
) -> tuple[Org, str, WorkspaceCreationInvite]:
    invite = get_valid_workspace_invite(db, invite_token, email=email)
    org = provision_org_from_workspace_invite(db, invite, org_name_override=org_name)
    return org, "owner", invite
