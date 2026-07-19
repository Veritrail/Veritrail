"""Workspace member invites and role management."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import current_user_principal
from app.core.db import get_db
from app.core.rbac import can_manage_members, current_org_user, normalize_role, require_owner
from app.models.org import Org, User
from app.models.org_team import ORG_ROLES, OrgInvite, OrgMembership
from app.services.org_activity import log_org_activity
from app.services.org_invites import (
    accept_invite_for_user,
    create_invite,
    ensure_can_invite_role,
    get_valid_invite,
    pending_invite_for_email,
)
from app.services.team_invite_email import send_team_invite_email

router = APIRouter()


class MemberOut(BaseModel):
    id: str
    email: str
    role: str
    created_at: str


class InviteOut(BaseModel):
    id: str
    email: str
    role: str
    status: str
    expires_at: str | None
    created_at: str
    invite_url: str
    email_sent: bool


class InvitePreviewOut(BaseModel):
    org_name: str
    email: str
    role: str
    expires_at: str | None
    create_workspace: bool = False
    plan: str | None = None
    suggested_org_name: str | None = None


class MemberInviteIn(BaseModel):
    email: EmailStr
    role: str = "viewer"
    expiry_days: int | None = None

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        v = v.lower().strip()
        if v not in ORG_ROLES:
            raise ValueError(f"role must be one of: {', '.join(sorted(ORG_ROLES))}")
        return v

    @field_validator("expiry_days")
    @classmethod
    def validate_expiry(cls, v: int | None) -> int | None:
        if v is not None and v not in (7, 14, 30):
            raise ValueError("expiry_days must be 7, 14, or 30, or omitted for no expiration")
        return v


class MemberRoleIn(BaseModel):
    role: str

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        v = v.lower().strip()
        if v not in ORG_ROLES or v == "owner":
            raise ValueError("role must be admin, editor, or viewer")
        return v


def _member_out(u: User, *, role: str | None = None) -> MemberOut:
    return MemberOut(
        id=str(u.id),
        email=u.email,
        role=normalize_role(role if role is not None else u.role),
        created_at=u.created_at.isoformat() if u.created_at else "",
    )


def _invite_out(invite: OrgInvite, *, email_sent: bool) -> InviteOut:
    settings = get_settings()
    invite_url = f"{settings.FRONTEND_URL.rstrip('/')}/invite/{invite.token}"
    return InviteOut(
        id=str(invite.id),
        email=invite.email,
        role=invite.role,
        status=invite.status,
        expires_at=invite.expires_at.isoformat() if invite.expires_at else None,
        created_at=invite.created_at.isoformat() if invite.created_at else "",
        invite_url=invite_url,
        email_sent=email_sent,
    )


@router.get("/me", response_model=MemberOut)
def get_me(user: User = Depends(current_org_user)):
    return _member_out(user)


@router.get("", response_model=list[MemberOut])
def list_members(user: User = Depends(current_org_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(User, OrgMembership.role)
        .join(OrgMembership, OrgMembership.user_id == User.id)
        .where(OrgMembership.org_id == user.org_id)
        .order_by(User.created_at)
    ).all()
    return [_member_out(u, role=role) for u, role in rows]


@router.get("/invites", response_model=list[InviteOut])
def list_invites(user: User = Depends(require_owner()), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(OrgInvite)
        .where(OrgInvite.org_id == user.org_id, OrgInvite.status == "pending")
        .order_by(OrgInvite.created_at.desc())
    ).all()
    return [_invite_out(i, email_sent=False) for i in rows]


@router.get("/invites/preview/{token}", response_model=InvitePreviewOut)
def preview_invite(token: str, db: Session = Depends(get_db)):
    from app.models.workspace_creation_invite import WorkspaceCreationInvite
    from app.services.workspace_creation_invites import get_valid_workspace_invite

    org_invite = db.scalar(
        select(OrgInvite).where(OrgInvite.token == token, OrgInvite.status == "pending")
    )
    if org_invite:
        invite = get_valid_invite(db, token)
        org = db.get(Org, invite.org_id)
        return InvitePreviewOut(
            org_name=org.name if org else "Workspace",
            email=invite.email,
            role=invite.role,
            expires_at=invite.expires_at.isoformat() if invite.expires_at else None,
        )

    if db.scalar(
        select(WorkspaceCreationInvite.id).where(
            WorkspaceCreationInvite.token == token,
            WorkspaceCreationInvite.status == "pending",
        )
    ):
        invite = get_valid_workspace_invite(db, token)
        suggested = (invite.org_name or "").strip() or None
        return InvitePreviewOut(
            org_name="Your workspace",
            email=invite.email,
            role="owner",
            expires_at=invite.expires_at.isoformat() if invite.expires_at else None,
            create_workspace=True,
            plan=invite.plan,
            suggested_org_name=suggested,
        )

    raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite not found or already used")


@router.post("/invites", response_model=InviteOut)
def invite_member(body: MemberInviteIn, user: User = Depends(require_owner()), db: Session = Depends(get_db)):
    org = db.get(Org, user.org_id)
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "org not found")
    ensure_can_invite_role(user, body.role)
    invite = create_invite(
        db,
        org=org,
        email=body.email,
        role=body.role,
        invited_by=user.id,
        expiry_days=body.expiry_days,
    )
    db.flush()
    settings = get_settings()
    invite_url = f"{settings.FRONTEND_URL.rstrip('/')}/invite/{invite.token}"
    email_sent = send_team_invite_email(
        to=invite.email,
        org_name=org.name or "Workspace",
        role=invite.role,
        invite_url=invite_url,
        expires_at=invite.expires_at,
    )
    log_org_activity(
        db,
        org_id=org.id,
        actor_user_id=user.id,
        action="member.invited",
        target_type="invite",
        target_id=str(invite.id),
        detail={"email": invite.email, "role": invite.role},
    )
    db.commit()
    db.refresh(invite)
    return _invite_out(invite, email_sent=email_sent)


@router.delete("/invites/{invite_id}")
def revoke_invite(invite_id: str, user: User = Depends(require_owner()), db: Session = Depends(get_db)):
    invite = db.get(OrgInvite, uuid.UUID(invite_id))
    if not invite or invite.org_id != user.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invite not found")
    invite.status = "revoked"
    log_org_activity(
        db,
        org_id=user.org_id,
        actor_user_id=user.id,
        action="member.invite_revoked",
        target_type="invite",
        target_id=str(invite.id),
        detail={"email": invite.email},
    )
    db.commit()
    return {"ok": True}


class AcceptInviteIn(BaseModel):
    token: str


class AcceptInviteOut(BaseModel):
    org_id: str
    org_name: str
    role: str
    access_token: str
    refresh_token: str = ""


@router.post("/invites/accept")
def accept_invite(
    body: AcceptInviteIn,
    request: Request,
    principal: dict = Depends(current_user_principal),
    db: Session = Depends(get_db),
):
    from fastapi.responses import JSONResponse

    from app.core.auth_cookies import attach_refresh_cookie, refresh_cookie_enabled
    from app.core.security import issue_refresh_token, issue_token
    from app.services.user_session import record_user_session

    user = db.get(User, uuid.UUID(principal["sub"]))
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    org, role = accept_invite_for_user(db, body.token, user)
    log_org_activity(
        db,
        org_id=org.id,
        actor_user_id=user.id,
        action="member.invite_accepted",
        target_type="user",
        target_id=str(user.id),
        detail={"email": user.email, "role": role},
    )
    uid, oid = str(user.id), str(user.org_id)
    access = issue_token(uid, oid)
    refresh = issue_refresh_token(uid, oid, remember_me=True)
    record_user_session(db, user.id, refresh, request)
    db.commit()
    payload: dict = {
        "org_id": oid,
        "org_name": org.name or "Workspace",
        "role": normalize_role(role),
        "access_token": access,
        "refresh_token": "" if refresh_cookie_enabled() else refresh,
    }
    resp = JSONResponse(content=payload)
    attach_refresh_cookie(resp, refresh, remember_me=True)
    return resp


@router.patch("/{member_id}", response_model=MemberOut)
def update_member_role(
    member_id: str,
    body: MemberRoleIn,
    user: User = Depends(require_owner()),
    db: Session = Depends(get_db),
):
    from app.services.org_membership import get_membership

    target = db.get(User, uuid.UUID(member_id))
    membership = get_membership(db, uuid.UUID(member_id), user.org_id) if target else None
    if not target or not membership:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")
    if normalize_role(membership.role) == "owner":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot change owner role — transfer ownership first")
    if target.id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot change your own role")
    old_role = normalize_role(membership.role)
    membership.role = body.role
    if target.org_id == user.org_id:
        target.role = body.role
    log_org_activity(
        db,
        org_id=user.org_id,
        actor_user_id=user.id,
        action="member.role_changed",
        target_type="user",
        target_id=str(target.id),
        detail={"email": target.email, "from": old_role, "to": body.role},
    )
    db.commit()
    db.refresh(target)
    return _member_out(target, role=membership.role)


@router.delete("/{member_id}")
def remove_member(member_id: str, user: User = Depends(require_owner()), db: Session = Depends(get_db)):
    from app.services.org_membership import get_membership, list_memberships, set_active_workspace

    target = db.get(User, uuid.UUID(member_id))
    membership = get_membership(db, uuid.UUID(member_id), user.org_id) if target else None
    if not target or not membership:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")
    if normalize_role(membership.role) == "owner":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot remove the workspace owner")
    if target.id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot remove yourself")
    log_org_activity(
        db,
        org_id=user.org_id,
        actor_user_id=user.id,
        action="member.removed",
        target_type="user",
        target_id=str(target.id),
        detail={"email": target.email, "role": normalize_role(membership.role)},
    )
    db.delete(membership)
    remaining = list_memberships(db, target.id)
    if not remaining:
        db.delete(target)
    elif target.org_id == user.org_id:
        set_active_workspace(db, target, remaining[0][0].org_id)
    db.commit()
    return {"ok": True}

