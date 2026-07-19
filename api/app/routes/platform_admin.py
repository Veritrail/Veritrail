"""Platform-admin dashboard (users / workspaces / access requests / invites / plans).

Access is gated server-side by PLATFORM_ADMIN_EMAILS (comma-separated, exact
email match). Non-admins get 404 so the endpoints don't advertise themselves.

Hardening on top of the email allowlist:
- Platform admins MUST have TOTP enrolled (403 "enroll MFA first" otherwise).
  A user with totp_enabled can only obtain tokens by completing the TOTP
  challenge, so every accepted session here is MFA-verified.
- Every call (allowed or denied) is written to platform_audit_logs — a
  platform-level trail, deliberately not org-scoped.
- slowapi per-IP rate limit on every endpoint (edge nginx limits apply too).
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.client_ip import client_ip_from_request
from app.core.config import get_settings
from app.core.db import get_db
from app.core.ratelimit import limiter
from app.core.security import current_user_principal
from app.data.plans import PLAN_TIERS
from app.models import AccessRequest, AwsAccount, Finding, Org, PlatformAuditLog, User, UserSession
from app.models.workspace_creation_invite import WorkspaceCreationInvite
from app.routes.platform_admin_schemas import (
    AdminPlanOut,
    WorkspaceInviteCreateIn,
    WorkspaceInviteOut,
    WorkspacePlanPatchIn,
)
from app.services.workspace_creation_invites import create_workspace_invite

router = APIRouter()

# Per-IP, per-route. The dashboard fires 3 requests per page load, so this
# still allows ~10 full reloads a minute while stopping scripted scraping.
ADMIN_RATE_LIMIT = "30/minute"

MFA_REQUIRED_DETAIL = "platform admins must enroll two-factor authentication (TOTP) before using this dashboard"

# Belt-and-suspenders: hide CI/smoke workspaces from the dashboard even if they
# land in prod before invite-only signup is enforced.
_TEST_SLUG_FILTER = or_(
    Org.slug.ilike("%smoke%"),
    Org.slug.ilike("%pills%"),
    Org.slug.ilike("verify-org%"),
    Org.slug.ilike("gap-check%"),
    Org.slug.ilike("vigil-smoke%"),
    Org.slug.ilike("test-org%"),
)
_TEST_EMAIL_FILTER = or_(
    User.email.ilike("%@veritrail-smoke%"),
    User.email.ilike("%@unique%.dev"),
    User.email.ilike("%.example.com"),
    User.email.ilike("%@veritrail-test.com"),
    User.email.ilike("%@vigil-smoke%"),
    User.email.ilike("%@test.com"),
)


def _exclude_test_workspaces():
    """SQL filter: drop orgs whose slug or member emails look like smoke/CI data."""
    test_org_ids = select(User.org_id).where(_TEST_EMAIL_FILTER).distinct()
    return ~or_(Org.slug.isnot(None) & _TEST_SLUG_FILTER, Org.id.in_(test_org_ids))


def platform_admin_emails() -> set[str]:
    raw = get_settings().PLATFORM_ADMIN_EMAILS
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def is_platform_admin(email: str | None) -> bool:
    return bool(email) and email.strip().lower() in platform_admin_emails()


def _audit(
    db: Session,
    request: Request,
    user: User | None,
    *,
    allowed: bool,
    reason: str | None = None,
    action: str | None = None,
    detail: dict | None = None,
) -> None:
    """Append + commit one platform-audit row. Committed immediately so the
    trail survives even if the endpoint itself errors afterwards."""
    payload = dict(detail or {})
    if reason:
        payload["reason"] = reason
    db.add(
        PlatformAuditLog(
            actor_user_id=user.id if user else None,
            actor_email=user.email if user else None,
            action=action or ("platform_admin.access" if allowed else "platform_admin.denied"),
            method=request.method,
            endpoint=request.url.path,
            source_ip=client_ip_from_request(request),
            allowed=allowed,
            detail=payload,
        )
    )
    db.commit()


def current_platform_admin(
    request: Request,
    principal: dict = Depends(current_user_principal),
    db: Session = Depends(get_db),
) -> User:
    user = db.get(User, uuid.UUID(principal["sub"]))
    if not user or not is_platform_admin(user.email):
        # Constant 404 — the endpoints never advertise themselves to non-admins.
        _audit(db, request, user, allowed=False, reason="not_platform_admin")
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    if not user.totp_enabled:
        _audit(db, request, user, allowed=False, reason="mfa_not_enrolled")
        raise HTTPException(status.HTTP_403_FORBIDDEN, MFA_REQUIRED_DETAIL)
    _audit(db, request, user, allowed=True)
    return user


class AdminUserOut(BaseModel):
    id: str
    email: str
    display_name: str | None
    role: str
    org_id: str
    org_name: str
    created_at: str | None
    last_seen_at: str | None


class AdminWorkspaceOut(BaseModel):
    id: str
    name: str
    slug: str | None
    plan: str
    created_at: str | None
    user_count: int
    accounts_connected: int
    findings: int
    last_scan_at: str | None


class AdminAccessRequestOut(BaseModel):
    id: str
    name: str
    email: str
    company: str
    message: str | None
    mail_sent: bool
    created_at: str | None


def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


@router.get("/users", response_model=list[AdminUserOut])
@limiter.limit(ADMIN_RATE_LIMIT)
def list_all_users(
    request: Request,
    _admin: User = Depends(current_platform_admin),
    db: Session = Depends(get_db),
):
    last_seen = (
        select(UserSession.user_id, func.max(UserSession.last_seen_at).label("last_seen_at"))
        .group_by(UserSession.user_id)
        .subquery()
    )
    rows = db.execute(
        select(User, Org.name, last_seen.c.last_seen_at)
        .join(Org, Org.id == User.org_id)
        .outerjoin(last_seen, last_seen.c.user_id == User.id)
        .where(_exclude_test_workspaces(), ~_TEST_EMAIL_FILTER)
        .order_by(User.created_at.desc())
    ).all()
    return [
        AdminUserOut(
            id=str(user.id),
            email=user.email,
            display_name=user.display_name,
            role=user.role,
            org_id=str(user.org_id),
            org_name=org_name or "Workspace",
            created_at=_iso(user.created_at),
            last_seen_at=_iso(seen),
        )
        for user, org_name, seen in rows
    ]


@router.get("/workspaces", response_model=list[AdminWorkspaceOut])
@limiter.limit(ADMIN_RATE_LIMIT)
def list_all_workspaces(
    request: Request,
    _admin: User = Depends(current_platform_admin),
    db: Session = Depends(get_db),
):
    user_counts = (
        select(User.org_id, func.count(User.id).label("n"))
        .group_by(User.org_id)
        .subquery()
    )
    account_stats = (
        select(
            AwsAccount.org_id,
            func.count(AwsAccount.id).filter(AwsAccount.status == "connected").label("connected"),
            func.max(AwsAccount.last_scan_at).label("last_scan_at"),
        )
        .group_by(AwsAccount.org_id)
        .subquery()
    )
    finding_counts = (
        select(Finding.org_id, func.count(Finding.id).label("n"))
        .group_by(Finding.org_id)
        .subquery()
    )
    rows = db.execute(
        select(
            Org,
            user_counts.c.n,
            account_stats.c.connected,
            account_stats.c.last_scan_at,
            finding_counts.c.n,
        )
        .where(_exclude_test_workspaces())
        .outerjoin(user_counts, user_counts.c.org_id == Org.id)
        .outerjoin(account_stats, account_stats.c.org_id == Org.id)
        .outerjoin(finding_counts, finding_counts.c.org_id == Org.id)
        .order_by(Org.created_at.desc())
    ).all()
    return [
        AdminWorkspaceOut(
            id=str(org.id),
            name=org.name or "Workspace",
            slug=org.slug,
            plan=org.plan,
            created_at=_iso(org.created_at),
            user_count=int(users or 0),
            accounts_connected=int(connected or 0),
            findings=int(findings or 0),
            last_scan_at=_iso(last_scan),
        )
        for org, users, connected, last_scan, findings in rows
    ]


@router.get("/access-requests", response_model=list[AdminAccessRequestOut])
@limiter.limit(ADMIN_RATE_LIMIT)
def list_access_requests(
    request: Request,
    _admin: User = Depends(current_platform_admin),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(AccessRequest).order_by(AccessRequest.created_at.desc()).limit(200)
    ).all()
    return [
        AdminAccessRequestOut(
            id=str(r.id),
            name=r.name,
            email=r.email,
            company=r.company,
            message=r.message,
            mail_sent=r.mail_sent,
            created_at=_iso(r.created_at),
        )
        for r in rows
    ]


def _get_mutable_workspace(db: Session, org_id: uuid.UUID) -> Org:
    org = db.get(Org, org_id)
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "workspace not found")
    hidden = db.scalar(select(Org.id).where(Org.id == org_id).where(_exclude_test_workspaces()))
    if hidden is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "workspace not found")
    return org


@router.get("/plans", response_model=list[AdminPlanOut])
@limiter.limit(ADMIN_RATE_LIMIT)
def list_plans(
    request: Request,
    _admin: User = Depends(current_platform_admin),
):
    return [
        AdminPlanOut(slug=tier.slug, label=tier.label, max_accounts=tier.max_accounts)
        for tier in PLAN_TIERS.values()
    ]


@router.get("/workspace-invites", response_model=list[WorkspaceInviteOut])
@limiter.limit(ADMIN_RATE_LIMIT)
def list_workspace_invites(
    request: Request,
    _admin: User = Depends(current_platform_admin),
    db: Session = Depends(get_db),
):
    settings = get_settings()
    base = settings.FRONTEND_URL.rstrip("/")
    rows = db.scalars(
        select(WorkspaceCreationInvite)
        .where(WorkspaceCreationInvite.status == "pending")
        .order_by(WorkspaceCreationInvite.created_at.desc())
        .limit(200)
    ).all()
    return [
        WorkspaceInviteOut(
            id=str(invite.id),
            email=invite.email,
            org_name=invite.org_name,
            plan=invite.plan,
            status=invite.status,
            expires_at=_iso(invite.expires_at),
            created_at=_iso(invite.created_at),
            invite_url=f"{base}/invite/{invite.token}",
        )
        for invite in rows
    ]


@router.post("/workspace-invites", response_model=WorkspaceInviteOut, status_code=status.HTTP_201_CREATED)
@limiter.limit(ADMIN_RATE_LIMIT)
def create_workspace_invite_endpoint(
    request: Request,
    body: WorkspaceInviteCreateIn,
    admin: User = Depends(current_platform_admin),
    db: Session = Depends(get_db),
):
    suggested_name = body.org_name.strip() or None
    invite = create_workspace_invite(
        db,
        email=str(body.email),
        org_name=suggested_name,
        plan=body.plan,
        created_by=admin.id,
        expiry_days=body.expiry_days,
        expiry_hours=body.expiry_hours,
    )
    db.flush()
    settings = get_settings()
    invite_url = f"{settings.FRONTEND_URL.rstrip('/')}/invite/{invite.token}"
    _audit(
        db,
        request,
        admin,
        allowed=True,
        action="platform_admin.workspace_invite_created",
        detail={
            "invite_id": str(invite.id),
            "email": invite.email,
            "suggested_org_name": invite.org_name,
            "plan": invite.plan,
            "expires_at": _iso(invite.expires_at),
        },
    )
    db.commit()
    db.refresh(invite)
    return WorkspaceInviteOut(
        id=str(invite.id),
        email=invite.email,
        org_name=invite.org_name,
        plan=invite.plan,
        status=invite.status,
        expires_at=_iso(invite.expires_at),
        created_at=_iso(invite.created_at),
        invite_url=invite_url,
    )


@router.patch("/workspaces/{org_id}/plan", response_model=AdminWorkspaceOut)
@limiter.limit(ADMIN_RATE_LIMIT)
def update_workspace_plan(
    org_id: str,
    body: WorkspacePlanPatchIn,
    request: Request,
    admin: User = Depends(current_platform_admin),
    db: Session = Depends(get_db),
):
    try:
        org_uuid = uuid.UUID(org_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid org id") from exc

    org = _get_mutable_workspace(db, org_uuid)

    old_plan = org.plan
    org.plan = body.plan
    _audit(
        db,
        request,
        admin,
        allowed=True,
        action="platform_admin.plan_changed",
        detail={"org_id": str(org.id), "org_name": org.name, "old_plan": old_plan, "new_plan": org.plan},
    )
    db.commit()
    db.refresh(org)

    user_count = db.scalar(select(func.count(User.id)).where(User.org_id == org.id)) or 0
    connected = db.scalar(
        select(func.count(AwsAccount.id)).where(
            AwsAccount.org_id == org.id, AwsAccount.status == "connected"
        )
    ) or 0
    findings = db.scalar(select(func.count(Finding.id)).where(Finding.org_id == org.id)) or 0
    last_scan = db.scalar(select(func.max(AwsAccount.last_scan_at)).where(AwsAccount.org_id == org.id))

    return AdminWorkspaceOut(
        id=str(org.id),
        name=org.name or "Workspace",
        slug=org.slug,
        plan=org.plan,
        created_at=_iso(org.created_at),
        user_count=int(user_count),
        accounts_connected=int(connected),
        findings=int(findings),
        last_scan_at=_iso(last_scan),
    )
