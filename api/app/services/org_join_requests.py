"""Request-access flow: a corporate-domain user asks to join an existing workspace."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.org import Org, User
from app.models.org_team import OrgJoinRequest
from app.services.org_domain import email_domain, is_public_email_domain, org_claiming_email_domain


def _norm(email: str) -> str:
    return (email or "").strip().lower()


def create_join_request(db: Session, email: str) -> tuple[Org, OrgJoinRequest] | None:
    """Raise a pending join request for the workspace claiming the email's domain.

    Returns None (silently) for public domains, unclaimed domains, or emails that
    already have an account — callers respond generically either way so the
    endpoint can't be used to enumerate workspaces.
    """
    norm = _norm(email)
    domain = email_domain(norm)
    if not domain or is_public_email_domain(domain):
        return None
    org = org_claiming_email_domain(db, norm)
    if not org:
        return None
    if db.scalar(select(User.id).where(User.email == norm)):
        return None  # already a member somewhere
    existing = db.scalar(
        select(OrgJoinRequest).where(
            OrgJoinRequest.email == norm,
            OrgJoinRequest.org_id == org.id,
            OrgJoinRequest.status == "pending",
        )
    )
    if existing:
        return org, existing
    jr = OrgJoinRequest(org_id=org.id, email=norm)
    db.add(jr)
    return org, jr


def list_pending_requests(db: Session, org_id) -> list[OrgJoinRequest]:
    return list(
        db.scalars(
            select(OrgJoinRequest)
            .where(OrgJoinRequest.org_id == org_id, OrgJoinRequest.status == "pending")
            .order_by(OrgJoinRequest.created_at.desc())
        ).all()
    )


def mark_decided(jr: OrgJoinRequest, *, status: str, decided_by) -> None:
    jr.status = status
    jr.decided_by = decided_by
    jr.decided_at = datetime.now(timezone.utc)
