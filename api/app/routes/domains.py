"""Org email-domain management: add → DNS-verify → enable auto-join."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.rbac import current_org_user, require_min_role
from app.models.org import User
from app.models.org_team import ORG_ROLES, OrgDomain
from app.services.org_domain import (
    dns_record_name,
    dns_record_value,
    new_verification_token,
    normalize_domain,
    verify_domain_dns,
)

router = APIRouter()

_ASSIGNABLE_AUTO_JOIN_ROLES = {r for r in ORG_ROLES if r != "owner"}


class DomainOut(BaseModel):
    id: str
    domain: str
    verified: bool
    verified_at: str | None
    auto_join_enabled: bool
    auto_join_role: str
    dns_record_name: str
    dns_record_value: str
    created_at: str


class DomainCreateIn(BaseModel):
    domain: str


class DomainPatchIn(BaseModel):
    auto_join_enabled: bool | None = None
    auto_join_role: str | None = None


def _out(d: OrgDomain) -> DomainOut:
    return DomainOut(
        id=str(d.id),
        domain=d.domain,
        verified=d.verified,
        verified_at=d.verified_at.isoformat() if d.verified_at else None,
        auto_join_enabled=d.auto_join_enabled,
        auto_join_role=d.auto_join_role,
        dns_record_name=dns_record_name(d.domain),
        dns_record_value=dns_record_value(d.verification_token),
        created_at=d.created_at.isoformat() if d.created_at else "",
    )


def _log(db: Session, org_id, actor_id, action: str, domain: str, detail: dict | None = None):
    try:
        from app.services.org_activity import log_org_activity

        log_org_activity(
            db,
            org_id=org_id,
            actor_user_id=actor_id,
            action=action,
            target_type="domain",
            target_id=domain,
            detail=detail or {},
        )
    except Exception:
        pass  # best-effort audit


@router.get("", response_model=list[DomainOut])
def list_domains(user: User = Depends(current_org_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(OrgDomain).where(OrgDomain.org_id == user.org_id).order_by(OrgDomain.created_at.desc())
    ).all()
    return [_out(d) for d in rows]


@router.post("", response_model=DomainOut)
def add_domain(
    body: DomainCreateIn,
    user: User = Depends(require_min_role("admin")),
    db: Session = Depends(get_db),
):
    domain = normalize_domain(body.domain)
    if not domain:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Enter a valid company domain (e.g. acme.com). Public email providers can't be claimed.",
        )

    existing = db.scalar(select(OrgDomain).where(OrgDomain.domain == domain))
    if existing:
        if existing.org_id == user.org_id:
            return _out(existing)
        raise HTTPException(status.HTTP_409_CONFLICT, "This domain is already claimed by another workspace.")

    d = OrgDomain(
        org_id=user.org_id,
        domain=domain,
        verification_token=new_verification_token(),
        created_by=user.id,
    )
    db.add(d)
    _log(db, user.org_id, user.id, "domain.added", domain)
    db.commit()
    db.refresh(d)
    return _out(d)


@router.post("/{domain_id}/verify", response_model=DomainOut)
def verify_domain(
    domain_id: str,
    user: User = Depends(require_min_role("admin")),
    db: Session = Depends(get_db),
):
    d = db.get(OrgDomain, uuid.UUID(domain_id))
    if not d or d.org_id != user.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "domain not found")
    if d.verified:
        return _out(d)

    if not verify_domain_dns(d.domain, d.verification_token):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"DNS TXT record not found yet. Add a TXT record at {dns_record_name(d.domain)} with value "
            f"\"{dns_record_value(d.verification_token)}\", then verify again. DNS can take a few minutes to propagate.",
        )

    d.verified = True
    d.verified_at = datetime.now(timezone.utc)
    _log(db, user.org_id, user.id, "domain.verified", d.domain)
    db.commit()
    db.refresh(d)
    return _out(d)


@router.patch("/{domain_id}", response_model=DomainOut)
def update_domain(
    domain_id: str,
    body: DomainPatchIn,
    user: User = Depends(require_min_role("admin")),
    db: Session = Depends(get_db),
):
    d = db.get(OrgDomain, uuid.UUID(domain_id))
    if not d or d.org_id != user.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "domain not found")

    if body.auto_join_role is not None:
        role = body.auto_join_role.lower().strip()
        if role not in _ASSIGNABLE_AUTO_JOIN_ROLES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "auto_join_role must be viewer, editor, or admin")
        d.auto_join_role = role

    if body.auto_join_enabled is not None:
        if body.auto_join_enabled and not d.verified:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Verify the domain before enabling auto-join.")
        d.auto_join_enabled = body.auto_join_enabled
        _log(
            db, user.org_id, user.id,
            "domain.auto_join_enabled" if body.auto_join_enabled else "domain.auto_join_disabled",
            d.domain,
            {"role": d.auto_join_role},
        )

    db.commit()
    db.refresh(d)
    return _out(d)


@router.delete("/{domain_id}", status_code=204)
def delete_domain(
    domain_id: str,
    user: User = Depends(require_min_role("admin")),
    db: Session = Depends(get_db),
):
    d = db.get(OrgDomain, uuid.UUID(domain_id))
    if not d or d.org_id != user.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "domain not found")
    domain = d.domain
    db.delete(d)
    _log(db, user.org_id, user.id, "domain.removed", domain)
    db.commit()
