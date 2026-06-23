"""Auditor access management endpoints (admin-only)."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import current_principal, issue_auditor_token
from app.services.auditor_invite_email import send_auditor_invite_email
from app.models.auditor import AuditorAccess, AuditActivityLog
from app.models.org import Org
from app.core.route_deps import RequireAdmin

router = APIRouter()


def _get_org(p, db: Session) -> Org:
    org = db.get(Org, uuid.UUID(p["org_id"]))
    if not org:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "org not found")
    return org


class AuditorInviteIn(BaseModel):
    email: str
    name: str | None = None
    expiry_days: int = 30  # 7, 14, 30, 90

    @field_validator("expiry_days")
    @classmethod
    def validate_expiry(cls, v: int) -> int:
        if v not in (7, 14, 30, 90):
            raise ValueError("expiry_days must be 7, 14, 30, or 90")
        return v


class AuditorAccessOut(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    email: str
    name: str | None
    access_token: str
    expires_at: str
    is_active: bool
    created_at: str
    last_accessed_at: str | None


class AuditorInviteOut(AuditorAccessOut):
    email_sent: bool
    email_delivery_note: str | None = None
    verify_url: str


def _to_out(a: AuditorAccess) -> AuditorAccessOut:
    return AuditorAccessOut(
        id=str(a.id),
        email=a.email,
        name=a.name,
        access_token=a.access_token,
        expires_at=a.expires_at.isoformat() if a.expires_at else "",
        is_active=a.is_active,
        created_at=a.created_at.isoformat() if a.created_at else "",
        last_accessed_at=a.last_accessed_at.isoformat() if a.last_accessed_at else None,
    )


def _dedupe_auditors_by_email(grants: list[AuditorAccess]) -> list[AuditorAccess]:
    """One row per email — list is already newest-first."""
    seen: set[str] = set()
    out: list[AuditorAccess] = []
    for grant in grants:
        key = grant.email.strip().lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(grant)
    return out


@router.post("/invite", response_model=AuditorInviteOut)
def invite_auditor(body: AuditorInviteIn, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    settings = get_settings()
    normalized_email = body.email.strip().lower()

    # Replace prior grants for this email so the table stays one row per auditor.
    prior = db.scalars(
        select(AuditorAccess).where(
            AuditorAccess.org_id == org.id,
            func.lower(AuditorAccess.email) == normalized_email,
        )
    ).all()
    for old in prior:
        old.is_active = False

    access_token = uuid.uuid4().hex + uuid.uuid4().hex  # 64-char hex token
    expires_at = datetime.now(timezone.utc) + timedelta(days=body.expiry_days)

    grant = AuditorAccess(
        org_id=org.id,
        email=normalized_email,
        name=body.name,
        access_token=access_token,
        expires_at=expires_at,
        is_active=True,
        created_by=uuid.UUID(p["sub"]) if p.get("sub") else None,
    )
    db.add(grant)
    db.commit()
    db.refresh(grant)

    verify_url = f"{settings.FRONTEND_URL.rstrip('/')}/auditor/verify/{access_token}"
    email_sent, email_note = send_auditor_invite_email(
        to=normalized_email,
        org_name=org.name or "Your organization",
        auditor_name=body.name,
        verify_url=verify_url,
        expires_at=expires_at,
    )

    base = _to_out(grant)
    return AuditorInviteOut(
        **base.model_dump(),
        email_sent=email_sent,
        email_delivery_note=email_note,
        verify_url=verify_url,
    )


@router.get("/list", response_model=list[AuditorAccessOut])
def list_auditors(p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    grants = db.scalars(
        select(AuditorAccess)
        .where(AuditorAccess.org_id == org.id)
        .order_by(AuditorAccess.created_at.desc())
    ).all()
    return [_to_out(g) for g in _dedupe_auditors_by_email(grants)]


@router.delete("/{auditor_id}")
def revoke_auditor(auditor_id: str, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    grant = db.get(AuditorAccess, uuid.UUID(auditor_id))
    if not grant or str(grant.org_id) != p["org_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "auditor grant not found")
    grant.is_active = False
    db.commit()
    return {"ok": True}


class ExtendIn(BaseModel):
    additional_days: int = 30

    @field_validator("additional_days")
    @classmethod
    def validate_days(cls, v: int) -> int:
        if v < 1 or v > 365:
            raise ValueError("additional_days must be 1-365")
        return v


@router.post("/{auditor_id}/extend", response_model=AuditorAccessOut)
def extend_auditor(auditor_id: str, body: ExtendIn, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    grant = db.get(AuditorAccess, uuid.UUID(auditor_id))
    if not grant or str(grant.org_id) != p["org_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "auditor grant not found")
    grant.expires_at = datetime.now(timezone.utc) + timedelta(days=body.additional_days)
    grant.is_active = True  # re-activate if it was expired
    db.commit()
    db.refresh(grant)
    return _to_out(grant)


class AuditorVerifyResponse(BaseModel):
    access_token: str
    org_name: str
    auditor_name: str | None
    expires_at: str


@router.post("/verify/{access_token}", response_model=AuditorVerifyResponse)
def verify_auditor_token(access_token: str, db: Session = Depends(get_db)):
    """Auditor verifies their invite token — returns a JWT for auditor-scoped access."""
    grants = db.scalars(
        select(AuditorAccess).where(
            AuditorAccess.access_token == access_token,
            AuditorAccess.is_active == True,
        )
    ).all()

    if not grants:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired auditor access token")

    now_dt = datetime.now(timezone.utc)
    valid_grant = None
    for g in grants:
        if g.expires_at > now_dt:
            valid_grant = g
            break

    if not valid_grant:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Auditor access token has expired")

    # Update last_accessed_at
    valid_grant.last_accessed_at = now_dt
    db.commit()

    org = db.get(Org, valid_grant.org_id)
    org_name = org.name if org else "Unknown"

    jwt_token = issue_auditor_token(
        auditor_access_id=str(valid_grant.id),
        org_id=str(valid_grant.org_id),
        ttl_hours=24,
    )

    return AuditorVerifyResponse(
        access_token=jwt_token,
        org_name=org_name,
        auditor_name=valid_grant.name,
        expires_at=valid_grant.expires_at.isoformat(),
    )
