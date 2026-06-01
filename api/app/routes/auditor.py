"""Auditor access management endpoints (admin-only)."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import current_principal, issue_auditor_token
from app.models.auditor import AuditorAccess, AuditActivityLog
from app.models.org import Org

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


@router.post("/invite", response_model=AuditorAccessOut)
def invite_auditor(body: AuditorInviteIn, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)

    access_token = uuid.uuid4().hex + uuid.uuid4().hex  # 64-char hex token
    expires_at = datetime.now(timezone.utc) + timedelta(days=body.expiry_days)

    grant = AuditorAccess(
        org_id=org.id,
        email=body.email,
        name=body.name,
        access_token=access_token,
        expires_at=expires_at,
        is_active=True,
        created_by=uuid.UUID(p["sub"]) if p.get("sub") else None,
    )
    db.add(grant)
    db.commit()
    db.refresh(grant)
    return _to_out(grant)


@router.get("/list", response_model=list[AuditorAccessOut])
def list_auditors(p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    grants = db.scalars(
        select(AuditorAccess)
        .where(AuditorAccess.org_id == org.id)
        .order_by(AuditorAccess.created_at.desc())
    ).all()
    return [_to_out(g) for g in grants]


@router.delete("/{auditor_id}")
def revoke_auditor(auditor_id: str, p=Depends(current_principal), db: Session = Depends(get_db)):
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
def extend_auditor(auditor_id: str, body: ExtendIn, p=Depends(current_principal), db: Session = Depends(get_db)):
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
