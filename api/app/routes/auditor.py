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
from app.core.org_context import resolve_org
from app.core.security import current_principal, issue_auditor_token
from app.services.auditor_invite_email import send_auditor_invite_email
from app.models.auditor import AuditorAccess, AuditActivityLog
from app.models.org import Org
from app.core.route_deps import RequireAdmin

router = APIRouter()


def _get_org(p, db: Session) -> Org:
    return resolve_org(db, p)


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


class EvidenceExportOut(BaseModel):
    id: str
    account_id: str
    framework: str
    period_days: int
    as_of: str | None
    report_id: str | None
    zip_sha256: str
    file_size_bytes: int
    vault_s3_uri: str | None
    created_at: str


class ScopedExportLinkIn(BaseModel):
    auditor_access_id: str
    ttl_hours: int = 168

    @field_validator("ttl_hours")
    @classmethod
    def validate_ttl(cls, v: int) -> int:
        if v < 1 or v > 720:
            raise ValueError("ttl_hours must be 1-720")
        return v


class ScopedExportLinkOut(BaseModel):
    export_id: str
    report_id: str | None
    link_type: str
    url: str
    expires_at: str
    instructions: str | None = None
    share_id: str | None = None


class VaultExportShareOut(BaseModel):
    id: str
    export_id: str
    auditor_access_id: str
    auditor_email: str
    link_type: str
    share_url: str
    expires_at: str
    status: str
    created_at: str
    approved_by: str | None = None


def _record_vault_share(
    db: Session,
    *,
    org_id: uuid.UUID,
    export_id: uuid.UUID,
    auditor_access_id: uuid.UUID,
    approved_by: uuid.UUID | None,
    link_type: str,
    share_url: str,
    expires_at: datetime,
) -> uuid.UUID:
    from app.models.phase9 import VaultExportShare

    row = VaultExportShare(
        id=uuid.uuid4(),
        org_id=org_id,
        export_id=export_id,
        auditor_access_id=auditor_access_id,
        approved_by=approved_by,
        link_type=link_type,
        share_url=share_url,
        expires_at=expires_at,
        status="active",
    )
    db.add(row)
    db.commit()
    return row.id


@router.get("/exports", response_model=list[EvidenceExportOut])
def list_evidence_exports(
    limit: int = Query(default=20, ge=1, le=100),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    from app.models import EvidenceExport

    org = _get_org(p, db)
    rows = db.scalars(
        select(EvidenceExport)
        .where(EvidenceExport.org_id == org.id)
        .order_by(EvidenceExport.created_at.desc())
        .limit(limit)
    ).all()
    return [
        EvidenceExportOut(
            id=str(r.id),
            account_id=str(r.account_id),
            framework=r.framework,
            period_days=r.period_days,
            as_of=r.as_of.isoformat() if r.as_of else None,
            report_id=r.report_id,
            zip_sha256=r.zip_sha256,
            file_size_bytes=r.file_size_bytes,
            vault_s3_uri=r.vault_s3_uri,
            created_at=r.created_at.isoformat() if r.created_at else "",
        )
        for r in rows
    ]


@router.post("/exports/{export_id}/scoped-link", response_model=ScopedExportLinkOut)
def create_scoped_export_link(
    export_id: str,
    body: ScopedExportLinkIn,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    from app.models import EvidenceExport
    from app.services.evidence_vault import (
        AuditorAccessMode,
        generate_presigned_get,
        plan_auditor_access,
        plan_from_stored_s3_uri,
        vault_config,
    )

    org = _get_org(p, db)
    settings = get_settings()
    try:
        exp_uuid = uuid.UUID(export_id)
        auditor_uuid = uuid.UUID(body.auditor_access_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid id")

    export_row = db.get(EvidenceExport, exp_uuid)
    if not export_row or str(export_row.org_id) != str(org.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "export not found")

    grant = db.get(AuditorAccess, auditor_uuid)
    if not grant or str(grant.org_id) != str(org.id) or not grant.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "auditor grant not found")

    expires_at = datetime.now(timezone.utc) + timedelta(hours=body.ttl_hours)
    approver_id = uuid.UUID(p["sub"]) if p.get("sub") else None

    if export_row.vault_s3_uri and export_row.report_id:
        plan = plan_from_stored_s3_uri(
            org_id=org.id,
            account_id=export_row.account_id,
            report_id=export_row.report_id,
            framework=export_row.framework,
            vault_s3_uri=export_row.vault_s3_uri,
            content_sha256=export_row.zip_sha256,
        )
        cfg = vault_config()
        if plan and cfg["auditor_access_mode"] != AuditorAccessMode.NONE:
            access = plan_auditor_access(plan, ttl_hours=body.ttl_hours)
            if access and access.presigned_url:
                share_id = _record_vault_share(
                    db,
                    org_id=org.id,
                    export_id=export_row.id,
                    auditor_access_id=grant.id,
                    approved_by=approver_id,
                    link_type="vault_presigned",
                    share_url=access.presigned_url,
                    expires_at=datetime.fromisoformat(
                        (access.expires_at or expires_at.isoformat()).replace("Z", "+00:00")
                    ),
                )
                return ScopedExportLinkOut(
                    export_id=str(export_row.id),
                    report_id=export_row.report_id,
                    link_type="vault_presigned",
                    url=access.presigned_url,
                    expires_at=access.expires_at or expires_at.isoformat(),
                    instructions="Time-limited download link for the immutable vault object. Share only with the approved auditor.",
                    share_id=str(share_id),
                )
            presigned = generate_presigned_get(plan, ttl_seconds=body.ttl_hours * 3600)
            if presigned:
                share_id = _record_vault_share(
                    db,
                    org_id=org.id,
                    export_id=export_row.id,
                    auditor_access_id=grant.id,
                    approved_by=approver_id,
                    link_type="vault_presigned",
                    share_url=presigned,
                    expires_at=expires_at,
                )
                return ScopedExportLinkOut(
                    export_id=str(export_row.id),
                    report_id=export_row.report_id,
                    link_type="vault_presigned",
                    url=presigned,
                    expires_at=expires_at.isoformat(),
                    instructions="Time-limited download link for the immutable vault object.",
                    share_id=str(share_id),
                )

    portal_url = (
        f"{settings.FRONTEND_URL.rstrip('/')}/auditor/export"
        f"?framework={export_row.framework}"
        f"&account_id={export_row.account_id}"
        f"&period={export_row.period_days}"
    )
    verify_url = f"{settings.FRONTEND_URL.rstrip('/')}/auditor/verify/{grant.access_token}"
    share_id = _record_vault_share(
        db,
        org_id=org.id,
        export_id=export_row.id,
        auditor_access_id=grant.id,
        approved_by=approver_id,
        link_type="auditor_portal",
        share_url=portal_url,
        expires_at=grant.expires_at,
    )
    return ScopedExportLinkOut(
        export_id=str(export_row.id),
        report_id=export_row.report_id,
        link_type="auditor_portal",
        url=portal_url,
        expires_at=grant.expires_at.isoformat(),
        instructions=(
            f"Auditor must verify access first ({verify_url}), then open the export page to download this pack."
        ),
        share_id=str(share_id),
    )


@router.get("/vault-shares", response_model=list[VaultExportShareOut])
def list_vault_shares(
    limit: int = Query(default=50, ge=1, le=200),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    from app.models.phase9 import VaultExportShare

    org = _get_org(p, db)
    rows = db.scalars(
        select(VaultExportShare)
        .where(VaultExportShare.org_id == org.id)
        .order_by(VaultExportShare.created_at.desc())
        .limit(limit)
    ).all()
    out: list[VaultExportShareOut] = []
    for row in rows:
        grant = db.get(AuditorAccess, row.auditor_access_id)
        out.append(
            VaultExportShareOut(
                id=str(row.id),
                export_id=str(row.export_id),
                auditor_access_id=str(row.auditor_access_id),
                auditor_email=grant.email if grant else "",
                link_type=row.link_type,
                share_url=row.share_url,
                expires_at=row.expires_at.isoformat(),
                status=row.status,
                created_at=row.created_at.isoformat(),
                approved_by=str(row.approved_by) if row.approved_by else None,
            )
        )
    return out
