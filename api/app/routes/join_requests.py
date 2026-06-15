"""Request-access: public request endpoint + admin approve/deny."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.ratelimit import limiter
from app.core.rbac import require_min_role
from app.models.org import Org, User
from app.models.org_team import ORG_ROLES, OrgJoinRequest
from app.services.org_join_requests import create_join_request, list_pending_requests, mark_decided

router = APIRouter()

_ASSIGNABLE_ROLES = {r for r in ORG_ROLES if r != "owner"}


class RequestAccessIn(BaseModel):
    email: EmailStr


class JoinRequestOut(BaseModel):
    id: str
    email: str
    created_at: str


class ApproveIn(BaseModel):
    role: str = "viewer"


@router.post("")
@limiter.limit("5/minute")
def request_access(request: Request, body: RequestAccessIn, db: Session = Depends(get_db)):
    """Public: ask to join the workspace that owns your email domain. Always returns
    the same generic response so it can't enumerate workspaces."""
    create_join_request(db, str(body.email))
    db.commit()
    return {"ok": True, "message": "If a workspace exists for your domain, its admins have been notified."}


@router.get("", response_model=list[JoinRequestOut])
def list_requests(user: User = Depends(require_min_role("admin")), db: Session = Depends(get_db)):
    return [
        JoinRequestOut(id=str(r.id), email=r.email, created_at=r.created_at.isoformat() if r.created_at else "")
        for r in list_pending_requests(db, user.org_id)
    ]


@router.post("/{request_id}/approve")
def approve_request(
    request_id: str,
    body: ApproveIn,
    user: User = Depends(require_min_role("admin")),
    db: Session = Depends(get_db),
):
    jr = db.get(OrgJoinRequest, uuid.UUID(request_id))
    if not jr or jr.org_id != user.org_id or jr.status != "pending":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "request not found")
    role = body.role.lower().strip()
    if role not in _ASSIGNABLE_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "role must be viewer, editor, or admin")

    from app.core.config import get_settings
    from app.services.org_invites import create_invite
    from app.services.team_invite_email import send_team_invite_email

    org = db.get(Org, user.org_id)
    invite = create_invite(db, org=org, email=jr.email, role=role, invited_by=user.id, expiry_days=14)
    mark_decided(jr, status="approved", decided_by=user.id)
    db.flush()

    settings = get_settings()
    invite_url = f"{settings.FRONTEND_URL.rstrip('/')}/invite/{invite.token}"
    send_team_invite_email(
        to=invite.email,
        org_name=(org.name if org else "Workspace") or "Workspace",
        role=role,
        invite_url=invite_url,
        expires_at=invite.expires_at,
    )

    try:
        from app.services.org_activity import log_org_activity

        log_org_activity(
            db, org_id=user.org_id, actor_user_id=user.id,
            action="member.join_request_approved", target_type="user", target_id=jr.email,
            detail={"role": role},
        )
    except Exception:
        pass
    db.commit()
    return {"ok": True, "invite_url": invite_url}


@router.post("/{request_id}/deny")
def deny_request(
    request_id: str,
    user: User = Depends(require_min_role("admin")),
    db: Session = Depends(get_db),
):
    jr = db.get(OrgJoinRequest, uuid.UUID(request_id))
    if not jr or jr.org_id != user.org_id or jr.status != "pending":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "request not found")
    mark_decided(jr, status="denied", decided_by=user.id)
    db.commit()
    return {"ok": True}
