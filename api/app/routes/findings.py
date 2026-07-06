import base64
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.db import get_db
from app.core.security import current_principal
from app.models import Finding, FindingEvent, AwsAccount
from app.models.azure_subscription import AzureSubscription
from app.models.gcp_project import GcpProject
from app.models.org import Org
from app.services.check_settings import hidden_check_ids
from app.core.route_deps import RequireEditor
from app.services.finding_supersession import (
    RETIRED_FINDING_CHECKS,
    resolve_retired_for_resource,
)

router = APIRouter()

REMEDIATION_TICKET_EVIDENCE_KEYS = (
    "jira",
    "github_issue",
    "iac_remediation_ticket",
    "linear",
    "azure_boards",
)


def clear_finding_remediation_ticket(finding: Finding) -> list[str]:
    """Unlink all remediation tickets stored on a finding. Returns removed issue keys."""
    removed: list[str] = []

    if finding.remediation_ticket_key:
        removed.append(finding.remediation_ticket_key)

    evidence = dict(finding.evidence or {})
    for key in REMEDIATION_TICKET_EVIDENCE_KEYS:
        entry = evidence.pop(key, None)
        if isinstance(entry, dict):
            issue_key = entry.get("issue_key")
            if isinstance(issue_key, str) and issue_key and issue_key not in removed:
                removed.append(issue_key)

    if removed or finding.remediation_ticket_key or finding.remediation_ticket_url:
        finding.remediation_ticket_key = None
        finding.remediation_ticket_url = None
        finding.evidence = evidence
        flag_modified(finding, "evidence")

    return removed


class FindingOut(BaseModel):
    id: str
    account_id: str | None = None
    aws_account_id: str | None = None
    account_label: str | None = None
    account_name: str | None = None
    account_provider: str = "aws"
    check_id: str
    resource_arn: str
    title: str
    severity: str
    risk_score: int
    status: str
    evidence: dict
    first_seen: datetime
    last_seen: datetime
    exception_reason: str | None = None
    exception_approved_by: str | None = None
    exception_expires_at: datetime | None = None
    remediation_ticket_key: str | None = None
    remediation_ticket_url: str | None = None

    class Config:
        from_attributes = True


def _account_display_name(acc: AwsAccount) -> str:
    label = (acc.label or "").strip()
    aid = (acc.account_id or "").strip()
    if label and label != aid:
        return label
    if label and not aid:
        return label
    return "AWS account"


def _vcs_provider(check_id: str) -> str | None:
    if check_id.startswith("github."):
        return "github"
    if check_id.startswith("gitlab."):
        return "gitlab"
    return None


def _scanner_provider(check_id: str) -> str | None:
    if not check_id.startswith("scanner."):
        return None
    parts = check_id.split(".")
    if len(parts) >= 2 and parts[1]:
        return parts[1]
    return "scanner"


def _scanner_scope_name(f: Finding) -> str:
    evidence = f.evidence if isinstance(f.evidence, dict) else {}
    source = evidence.get("source")
    if isinstance(source, str) and source.strip():
        return source.strip()
    vendor = _scanner_provider(f.check_id)
    if vendor == "wiz":
        return "Wiz"
    if vendor == "tenable":
        return "Tenable"
    if vendor == "qualys":
        return "Qualys"
    return "Vulnerability scanner"


def _vcs_scope_name(f: Finding) -> str:
    evidence = f.evidence if isinstance(f.evidence, dict) else {}
    for key in ("source", "org", "organization"):
        raw = evidence.get(key)
        if isinstance(raw, str) and raw.strip():
            return raw.strip().lstrip("/")
    arn = (f.resource_arn or "").strip()
    if "://org/" in arn:
        slug = arn.split("://org/", 1)[-1].split("/")[0].split("?")[0]
        if slug:
            return slug
    for prefix in ("github://", "gitlab://"):
        if arn.startswith(prefix):
            rest = arn[len(prefix) :].lstrip("/")
            if rest.startswith("repo/"):
                rest = rest[5:]
            if rest.startswith("org/"):
                rest = rest[4:]
            segment = rest.split("/")[0] if rest else ""
            if segment:
                return segment
    provider = _vcs_provider(f.check_id)
    if provider == "github":
        return "GitHub organization"
    if provider == "gitlab":
        return "GitLab group"
    return "Git organization"


def _load_org_accounts(db: Session, org_id: uuid.UUID) -> dict[uuid.UUID, AwsAccount]:
    rows = db.scalars(select(AwsAccount).where(AwsAccount.org_id == org_id)).all()
    return {a.id: a for a in rows}


def _load_org_gcp_projects(db: Session, org_id: uuid.UUID) -> dict[uuid.UUID, GcpProject]:
    rows = db.scalars(select(GcpProject).where(GcpProject.org_id == org_id)).all()
    return {p.id: p for p in rows}


def _load_org_azure_subscriptions(db: Session, org_id: uuid.UUID) -> dict[uuid.UUID, AzureSubscription]:
    rows = db.scalars(select(AzureSubscription).where(AzureSubscription.org_id == org_id)).all()
    return {s.id: s for s in rows}


def _scope_maps(db: Session, org_id: uuid.UUID):
    return (
        _load_org_accounts(db, org_id),
        _load_org_gcp_projects(db, org_id),
        _load_org_azure_subscriptions(db, org_id),
    )


def _apply_scope_filter(
    q,
    *,
    account_id: uuid.UUID | None = None,
    gcp_project_id: uuid.UUID | None = None,
    azure_subscription_id: uuid.UUID | None = None,
):
    # Cloud scope only. Source-control findings are org-level and NOT tied to a
    # cloud account — they have their own scope on the Findings page
    # (?provider=github|gitlab), so they must not leak into an account's view.
    if account_id is not None:
        return q.where(Finding.account_id == account_id)
    if gcp_project_id is not None:
        return q.where(Finding.gcp_project_id == gcp_project_id)
    if azure_subscription_id is not None:
        return q.where(Finding.azure_subscription_id == azure_subscription_id)
    return q


def _apply_provider_or_scope(
    q,
    *,
    provider: str | None,
    account_id: uuid.UUID | None,
    gcp_project_id: uuid.UUID | None,
    azure_subscription_id: uuid.UUID | None,
):
    """Source-control provider scope OR cloud scope — never both.

    ?provider=github|gitlab is a first-class Findings scope: org-level
    source-control findings (account_id NULL, github.*/gitlab.*). It is mutually
    exclusive with cloud account scope so the two domains never mix.
    """
    if provider in ("github", "gitlab"):
        return q.where(
            Finding.account_id.is_(None),
            Finding.check_id.like(f"{provider}.%"),
        )
    return _apply_scope_filter(
        q,
        account_id=account_id,
        gcp_project_id=gcp_project_id,
        azure_subscription_id=azure_subscription_id,
    )


class FindingPage(BaseModel):
    items: list[FindingOut]
    total: int
    next_cursor: str | None


class FindingSummaryOut(BaseModel):
    total: int
    by_status: dict[str, int]
    by_severity: dict[str, int]
    top_checks: list[dict[str, int | str]]


@router.get("/summary", response_model=FindingSummaryOut)
def findings_summary(
    account_id: str | None = None,
    gcp_project_id: str | None = None,
    azure_subscription_id: str | None = None,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org_id = uuid.UUID(p["org_id"])
    org = db.get(Org, org_id)
    hidden = hidden_check_ids(org.settings if org else {}) | RETIRED_FINDING_CHECKS
    acc_uuid = uuid.UUID(account_id) if account_id else None
    gcp_uuid = uuid.UUID(gcp_project_id) if gcp_project_id else None
    az_uuid = uuid.UUID(azure_subscription_id) if azure_subscription_id else None

    def _scoped(q):
        q = q.where(Finding.org_id == org_id)
        if hidden:
            q = q.where(Finding.check_id.notin_(hidden))
        return _apply_scope_filter(
            q,
            account_id=acc_uuid,
            gcp_project_id=gcp_uuid,
            azure_subscription_id=az_uuid,
        )

    total = db.scalar(select(func.count()).select_from(_scoped(select(Finding)).subquery())) or 0

    by_status: dict[str, int] = {}
    for st, ct in db.execute(
        _scoped(select(Finding.status, func.count())).group_by(Finding.status)
    ).all():
        by_status[st] = int(ct)

    by_severity: dict[str, int] = {}
    for sev, ct in db.execute(
        _scoped(select(Finding.severity, func.count()))
        .where(Finding.status == "open")
        .group_by(Finding.severity)
    ).all():
        by_severity[sev] = int(ct)

    top_rows = db.execute(
        _scoped(select(Finding.check_id, func.count().label("count")))
        .where(Finding.status == "open")
        .group_by(Finding.check_id)
        .order_by(func.count().desc())
        .limit(20)
    ).all()
    top_checks = [{"check_id": row[0], "count": int(row[1])} for row in top_rows]

    return FindingSummaryOut(
        total=total,
        by_status=by_status,
        by_severity=by_severity,
        top_checks=top_checks,
    )


class ActivityMarkerOut(BaseModel):
    ts: datetime
    kind: str
    detail: str | None = None
    scan_run_id: str | None = None


class FindingActivityOut(BaseModel):
    finding_id: str
    status: str
    first_seen: datetime
    last_seen: datetime
    open_days: int
    markers: list[ActivityMarkerOut]


def _encode_cursor(risk_score: int, id: uuid.UUID) -> str:
    return base64.urlsafe_b64encode(f"{risk_score}:{id}".encode()).decode()


def _decode_cursor(cursor: str) -> tuple[int, uuid.UUID]:
    raw = base64.urlsafe_b64decode(cursor.encode()).decode()
    score_s, id_s = raw.split(":", 1)
    return int(score_s), uuid.UUID(id_s)


class SnoozeIn(BaseModel):
    days: int = 30
    note: str | None = None


class ResolveIn(BaseModel):
    note: str | None = None
    verified: bool = False


class ExceptionIn(BaseModel):
    reason: str
    approved_by: str
    expires_at: datetime | None = None


def _cloud_provider(check_id: str) -> str | None:
    if check_id.startswith("gcp."):
        return "gcp"
    if check_id.startswith("azure."):
        return "azure"
    return None


def _cloud_scope_name(
    f: Finding,
    gcp_projects: dict[uuid.UUID, GcpProject] | None = None,
    azure_subscriptions: dict[uuid.UUID, AzureSubscription] | None = None,
) -> str:
    if f.gcp_project_id and gcp_projects:
        proj = gcp_projects.get(f.gcp_project_id)
        if proj:
            label = (proj.label or "").strip()
            if label and label != proj.project_id:
                return label
            return proj.project_id
    if f.azure_subscription_id and azure_subscriptions:
        sub = azure_subscriptions.get(f.azure_subscription_id)
        if sub:
            label = (sub.label or "").strip()
            if label and label != sub.subscription_id:
                return label
            return sub.subscription_id
    evidence = f.evidence if isinstance(f.evidence, dict) else {}
    for key in ("project_id", "subscription_id"):
        raw = evidence.get(key)
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
    return "Cloud resource"


def _to_out(
    f: Finding,
    accounts: dict[uuid.UUID, AwsAccount] | None = None,
    gcp_projects: dict[uuid.UUID, GcpProject] | None = None,
    azure_subscriptions: dict[uuid.UUID, AzureSubscription] | None = None,
) -> FindingOut:
    vcs = _vcs_provider(f.check_id)
    cloud = _cloud_provider(f.check_id)
    scanner = _scanner_provider(f.check_id)
    ticket_key = f.remediation_ticket_key
    ticket_url = f.remediation_ticket_url
    if not ticket_key:
        jira = (f.evidence or {}).get("jira") if isinstance(f.evidence, dict) else None
        if isinstance(jira, dict) and jira.get("issue_key"):
            ticket_key = jira.get("issue_key")
            ticket_url = jira.get("issue_url")
    if vcs:
        scope = _vcs_scope_name(f)
        return FindingOut(
            id=str(f.id),
            account_id=str(f.account_id) if f.account_id else None,
            aws_account_id=None,
            account_label=scope,
            account_name=scope,
            account_provider=vcs,
            check_id=f.check_id,
            resource_arn=f.resource_arn,
            title=f.title,
            severity=f.severity,
            risk_score=f.risk_score,
            status=f.status,
            evidence=f.evidence,
            first_seen=f.first_seen,
            last_seen=f.last_seen,
            exception_reason=f.exception_reason,
            exception_approved_by=f.exception_approved_by,
            exception_expires_at=f.exception_expires_at,
            remediation_ticket_key=ticket_key,
            remediation_ticket_url=ticket_url,
        )
    if scanner:
        scope = _scanner_scope_name(f)
        return FindingOut(
            id=str(f.id),
            account_id=str(f.account_id) if f.account_id else None,
            aws_account_id=None,
            account_label=scope,
            account_name=scope,
            account_provider=scanner,
            check_id=f.check_id,
            resource_arn=f.resource_arn,
            title=f.title,
            severity=f.severity,
            risk_score=f.risk_score,
            status=f.status,
            evidence=f.evidence,
            first_seen=f.first_seen,
            last_seen=f.last_seen,
            exception_reason=f.exception_reason,
            exception_approved_by=f.exception_approved_by,
            exception_expires_at=f.exception_expires_at,
            remediation_ticket_key=ticket_key,
            remediation_ticket_url=ticket_url,
        )
    if cloud:
        scope = _cloud_scope_name(f, gcp_projects, azure_subscriptions)
        return FindingOut(
            id=str(f.id),
            account_id=str(f.account_id) if f.account_id else None,
            aws_account_id=None,
            account_label=scope,
            account_name=scope,
            account_provider=cloud,
            check_id=f.check_id,
            resource_arn=f.resource_arn,
            title=f.title,
            severity=f.severity,
            risk_score=f.risk_score,
            status=f.status,
            evidence=f.evidence,
            first_seen=f.first_seen,
            last_seen=f.last_seen,
            exception_reason=f.exception_reason,
            exception_approved_by=f.exception_approved_by,
            exception_expires_at=f.exception_expires_at,
            remediation_ticket_key=ticket_key,
            remediation_ticket_url=ticket_url,
        )
    acc = (accounts or {}).get(f.account_id) if f.account_id else None
    return FindingOut(
        id=str(f.id),
        account_id=str(f.account_id) if f.account_id else None,
        aws_account_id=acc.account_id if acc else None,
        account_label=acc.label if acc else None,
        account_name=_account_display_name(acc) if acc else None,
        account_provider="aws",
        check_id=f.check_id,
        resource_arn=f.resource_arn,
        title=f.title,
        severity=f.severity,
        risk_score=f.risk_score,
        status=f.status,
        evidence=f.evidence,
        first_seen=f.first_seen,
        last_seen=f.last_seen,
        exception_reason=f.exception_reason,
        exception_approved_by=f.exception_approved_by,
        exception_expires_at=f.exception_expires_at,
        remediation_ticket_key=ticket_key,
        remediation_ticket_url=ticket_url,
    )


@router.get("", response_model=FindingPage)
def list_findings(
    status_filter: str | None = Query(default="open", alias="status"),
    severity: str | None = None,
    check_id: str | None = None,
    account_id: str | None = None,
    gcp_project_id: str | None = None,
    azure_subscription_id: str | None = None,
    provider: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    cursor: str | None = Query(default=None),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org_id = uuid.UUID(p["org_id"])
    org = db.get(Org, org_id)
    hidden = hidden_check_ids(org.settings if org else {}) | RETIRED_FINDING_CHECKS
    acc_uuid = uuid.UUID(account_id) if account_id else None
    gcp_uuid = uuid.UUID(gcp_project_id) if gcp_project_id else None
    az_uuid = uuid.UUID(azure_subscription_id) if azure_subscription_id else None

    base_q = select(Finding).where(Finding.org_id == org_id)
    if hidden:
        base_q = base_q.where(Finding.check_id.notin_(hidden))
    if status_filter and status_filter != "all":
        base_q = base_q.where(Finding.status == status_filter)
    if severity:
        base_q = base_q.where(Finding.severity == severity)
    if check_id:
        base_q = base_q.where(Finding.check_id == check_id)
    base_q = _apply_provider_or_scope(
        base_q,
        provider=provider,
        account_id=acc_uuid,
        gcp_project_id=gcp_uuid,
        azure_subscription_id=az_uuid,
    )

    total = db.scalar(select(func.count()).select_from(base_q.subquery()))

    q = base_q.order_by(Finding.risk_score.desc(), Finding.id.desc())
    if cursor:
        try:
            cur_score, cur_id = _decode_cursor(cursor)
            q = q.where(
                (Finding.risk_score < cur_score)
                | ((Finding.risk_score == cur_score) & (Finding.id < cur_id))
            )
        except Exception:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid cursor")

    rows = db.scalars(q.limit(limit + 1)).all()
    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = _encode_cursor(items[-1].risk_score, items[-1].id) if has_more and items else None

    accounts, gcp_projects, azure_subscriptions = _scope_maps(db, org_id)
    return FindingPage(
        items=[
            _to_out(f, accounts, gcp_projects, azure_subscriptions) for f in items
        ],
        total=total,
        next_cursor=next_cursor,
    )


def _get_owned(db: Session, p, finding_id: str) -> Finding:
    f = db.get(Finding, uuid.UUID(finding_id))
    if not f or str(f.org_id) != p["org_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "finding not found")
    return f


@router.get("/{finding_id}/activity", response_model=FindingActivityOut)
def finding_activity(
    finding_id: str,
    days: int = Query(90, ge=7, le=365),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    from app.services.finding_activity import build_finding_activity

    f = _get_owned(db, p, finding_id)
    raw = build_finding_activity(db, f, days=days)
    return FindingActivityOut(
        finding_id=raw["finding_id"],
        status=raw["status"],
        first_seen=raw["first_seen"],
        last_seen=raw["last_seen"],
        open_days=raw["open_days"],
        markers=[
            ActivityMarkerOut(
                ts=m["ts"],
                kind=m["kind"],
                detail=m["detail"],
                scan_run_id=str(m["scan_run_id"]) if m["scan_run_id"] else None,
            )
            for m in raw["markers"]
        ],
    )


@router.post("/{finding_id}/snooze", response_model=FindingOut)
def snooze(finding_id: str, body: SnoozeIn, _rbac: RequireEditor, p=Depends(current_principal), db: Session = Depends(get_db)):
    f = _get_owned(db, p, finding_id)
    f.status = "snoozed"
    f.snooze_until = datetime.now(timezone.utc) + timedelta(days=body.days)
    db.add(FindingEvent(id=uuid.uuid4(), finding_id=f.id, action="snoozed", actor=p["sub"], note=body.note))
    db.commit()
    accounts, gcp_projects, azure_subscriptions = _scope_maps(db, f.org_id)
    return _to_out(f, accounts, gcp_projects, azure_subscriptions)


@router.post("/{finding_id}/resolve", response_model=FindingOut)
def resolve(finding_id: str, body: ResolveIn, _rbac: RequireEditor, p=Depends(current_principal), db: Session = Depends(get_db)):
    if not body.verified:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Confirm verification before resolving (re-scan or manual check)",
        )
    f = _get_owned(db, p, finding_id)
    now = datetime.now(timezone.utc)
    f.status = "resolved"
    f.resolved_at = now
    db.add(FindingEvent(id=uuid.uuid4(), finding_id=f.id, action="resolved", actor=p["sub"], note=body.note))
    resolve_retired_for_resource(db, canonical=f, now=now, actor=p["sub"])
    db.commit()
    accounts, gcp_projects, azure_subscriptions = _scope_maps(db, f.org_id)
    return _to_out(f, accounts, gcp_projects, azure_subscriptions)


@router.post("/{finding_id}/reopen", response_model=FindingOut)
def reopen(finding_id: str, _rbac: RequireEditor, p=Depends(current_principal), db: Session = Depends(get_db)):
    f = _get_owned(db, p, finding_id)
    if f.status not in ("resolved", "ignored"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "only resolved or ignored findings can be reopened")
    f.status = "open"
    f.resolved_at = None
    f.snooze_until = None
    db.add(FindingEvent(id=uuid.uuid4(), finding_id=f.id, action="reopened", actor=p["sub"]))
    db.commit()
    accounts, gcp_projects, azure_subscriptions = _scope_maps(db, f.org_id)
    return _to_out(f, accounts, gcp_projects, azure_subscriptions)


@router.post("/{finding_id}/ignore", response_model=FindingOut)
def ignore(finding_id: str, _rbac: RequireEditor, p=Depends(current_principal), db: Session = Depends(get_db)):
    f = _get_owned(db, p, finding_id)
    f.status = "ignored"
    db.add(FindingEvent(id=uuid.uuid4(), finding_id=f.id, action="ignored", actor=p["sub"]))
    db.commit()
    accounts, gcp_projects, azure_subscriptions = _scope_maps(db, f.org_id)
    return _to_out(f, accounts, gcp_projects, azure_subscriptions)


@router.post("/{finding_id}/exception", response_model=FindingOut)
def create_exception(finding_id: str, body: ExceptionIn, _rbac: RequireEditor, p=Depends(current_principal), db: Session = Depends(get_db)):
    f = _get_owned(db, p, finding_id)
    f.status = "excepted"
    f.exception_reason = body.reason
    f.exception_approved_by = body.approved_by
    f.exception_expires_at = body.expires_at
    db.add(FindingEvent(
        id=uuid.uuid4(),
        finding_id=f.id,
        action="excepted",
        actor=p["sub"],
        note=f"Approved by {body.approved_by}: {body.reason}",
    ))
    db.commit()
    accounts, gcp_projects, azure_subscriptions = _scope_maps(db, f.org_id)
    return _to_out(f, accounts, gcp_projects, azure_subscriptions)


@router.delete("/{finding_id}/remediation-ticket", response_model=FindingOut)
def clear_remediation_ticket_link(
    finding_id: str,
    _rbac: RequireEditor,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Remove remediation ticket link(s) from a finding without closing external issues."""
    f = _get_owned(db, p, finding_id)
    removed = clear_finding_remediation_ticket(f)
    if removed:
        keys = ", ".join(removed)
        suffix = "s" if len(removed) > 1 else ""
        db.add(
            FindingEvent(
                id=uuid.uuid4(),
                finding_id=f.id,
                action="note",
                actor=p.get("sub"),
                note=f"Removed remediation ticket link{suffix}: {keys}",
            )
        )
    db.commit()
    accounts, gcp_projects, azure_subscriptions = _scope_maps(db, f.org_id)
    return _to_out(f, accounts, gcp_projects, azure_subscriptions)


@router.get("/{finding_id}/remediation-plan")
def remediation_plan(finding_id: str, p=Depends(current_principal), db: Session = Depends(get_db)):
    """Customer-hosted remediation plan preview (no execution)."""
    from app.services.remediation_plan import build_remediation_plan

    f = _get_owned(db, p, finding_id)
    return build_remediation_plan(f)


@router.get("/{finding_id}/iac-snippets")
def iac_snippets(finding_id: str, p=Depends(current_principal), db: Session = Depends(get_db)):
    """Deterministic Terraform / CLI snippets (Phase 1 — not automatic PR)."""
    from app.services.iac_snippets import build_iac_remediation

    f = _get_owned(db, p, finding_id)
    return build_iac_remediation(db, f, uuid.UUID(p["org_id"]))


class TerraformPrIn(BaseModel):
    repo_full_name: str
    file_path: str = "veritrail/remediation.tf"
    base_branch: str | None = None


@router.post("/{finding_id}/iac/terraform-pr")
def create_terraform_pr_route(
    finding_id: str,
    body: TerraformPrIn,
    _rbac: RequireEditor, p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Open a GitHub PR with repo-aware HCL patch + terraform validate."""
    from app.services.terraform_pr import build_terraform_pr

    f = _get_owned(db, p, finding_id)
    try:
        return build_terraform_pr(
            db,
            finding=f,
            org_id=uuid.UUID(p["org_id"]),
            repo_full_name=body.repo_full_name,
            file_path=body.file_path,
            base_branch=body.base_branch,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e


class TerraformRepoScanIn(BaseModel):
    repo_full_name: str
    base_branch: str | None = None


@router.post("/{finding_id}/iac/repo-scan")
def terraform_repo_scan(
    finding_id: str,
    body: TerraformRepoScanIn,
    _rbac: RequireEditor, p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Scan connected repo .tf/.hcl for resources matching this finding."""
    from app.services.terraform_pr import scan_repo_for_finding

    f = _get_owned(db, p, finding_id)
    try:
        return scan_repo_for_finding(
            db,
            finding=f,
            org_id=uuid.UUID(p["org_id"]),
            repo_full_name=body.repo_full_name,
            base_branch=body.base_branch,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e


@router.get("/{finding_id}/remediation-execution")
def get_remediation_execution(finding_id: str, p=Depends(current_principal), db: Session = Depends(get_db)):
    """Latest execution record for a finding (by most recent dispatch)."""
    from sqlalchemy import select

    from app.models.remediation_execution import RemediationExecution

    from app.models import AwsAccount
    from app.services.remediation_execution_sync import sync_remediation_execution_from_ssm

    f = _get_owned(db, p, finding_id)
    row = db.scalar(
        select(RemediationExecution)
        .where(RemediationExecution.finding_id == f.id)
        .order_by(RemediationExecution.dispatched_at.desc())
        .limit(1)
    )
    if not row:
        return {"status": "none"}
    acc = db.get(AwsAccount, row.account_id)
    sync_meta: dict = {}
    if acc and acc.role_arn:
        row, sync_meta = sync_remediation_execution_from_ssm(db, row=row, account=acc)
    result = row.result_json if isinstance(row.result_json, dict) else {}
    return {
        "plan_id": row.plan_id,
        "status": row.status,
        "dispatched_at": row.dispatched_at.isoformat() if row.dispatched_at else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
        "result": row.result_json,
        "error": row.error,
        "automation_execution_id": result.get("automation_execution_id"),
        "ssm_status": sync_meta.get("ssm_status") or result.get("ssm_status"),
        "status_sync": sync_meta or None,
    }


class RemediationDispatchIn(BaseModel):
    execute: bool = False
    parameter_overrides: dict[str, str] | None = None


@router.post("/{finding_id}/remediation/dispatch")
def remediation_dispatch(
    finding_id: str,
    _rbac: RequireEditor,
    body: RemediationDispatchIn = RemediationDispatchIn(),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Approve remediation plan; start SSM Automation only when body.execute is true."""
    from app.services.remediation_dispatch import build_remediation_dispatch

    from app.services.remediation_iam_policy_plan import IamPolicyRemediationNotReady

    f = _get_owned(db, p, finding_id)
    approved_by = p.get("sub") or p.get("email") or "unknown"
    try:
        return build_remediation_dispatch(
            f,
            approved_by=str(approved_by),
            db=db,
            org_id=uuid.UUID(p["org_id"]),
            execute=body.execute,
            parameter_overrides=body.parameter_overrides,
        )
    except IamPolicyRemediationNotReady as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=exc.detail) from exc


class TriageTriggerResponse(BaseModel):
    queued: bool = False
    result: dict | None = None
    ai_triage_enabled: bool = False


class TriageResultOut(BaseModel):
    id: str
    finding_id: str
    confidence_score: float
    rationale: str
    suggested_action: str
    model_version: str
    created_at: datetime

    class Config:
        from_attributes = True


def _triage_api_response(finding, row, *, llm_configured: bool) -> dict:
    from app.services.ai_triage_store import triage_row_to_api
    from app.services.ai_finding_review import heuristic_triage_payload, LOCAL_MODEL_VERSION

    if row:
        result = triage_row_to_api(row)
        review_mode = "llm" if row.model_version != LOCAL_MODEL_VERSION else "local"
    else:
        result = heuristic_triage_payload(finding)
        review_mode = "local"
    return {
        "ai_triage_enabled": True,
        "llm_configured": llm_configured,
        "review_mode": review_mode,
        "result": result,
    }


@router.get("/{finding_id}/triage", response_model=TriageResultOut | dict)
def get_triage(finding_id: str, p=Depends(current_principal), db: Session = Depends(get_db)):
    """Fetch the latest AI triage result for a finding."""
    from app.models.ai_triage import AITriageResult
    from app.models.org import Org
    from app.services.ai_finding_review import llm_triage_available, org_ai_finding_review_enabled

    finding = _get_owned(db, p, finding_id)
    org = db.get(Org, finding.org_id)
    if not org_ai_finding_review_enabled(org):
        return {"ai_triage_enabled": False, "llm_configured": False}

    row = db.scalar(
        select(AITriageResult)
        .where(AITriageResult.finding_id == uuid.UUID(finding_id))
        .order_by(AITriageResult.created_at.desc())
        .limit(1)
    )
    llm_ready = llm_triage_available()
    if row:
        return _triage_api_response(finding, row, llm_configured=llm_ready)
    if not llm_ready:
        return _triage_api_response(finding, None, llm_configured=False)
    return {"ai_triage_enabled": True, "llm_configured": True, "review_mode": "llm", "result": None}


@router.post("/{finding_id}/triage", response_model=TriageTriggerResponse)
def trigger_triage(finding_id: str, _rbac: RequireEditor, p=Depends(current_principal), db: Session = Depends(get_db)):
    """Manually trigger AI triage for a single finding."""
    from app.models.org import Org
    from app.services.ai_finding_review import (
        heuristic_triage_payload,
        llm_triage_available,
        org_ai_finding_review_enabled,
        LOCAL_MODEL_VERSION,
    )
    from app.services.ai_triage_store import save_triage_result, triage_row_to_api

    finding = _get_owned(db, p, finding_id)
    org = db.get(Org, finding.org_id)
    if not org_ai_finding_review_enabled(org):
        return TriageTriggerResponse(queued=False, ai_triage_enabled=False)

    if not llm_triage_available():
        payload = heuristic_triage_payload(finding)
        row = save_triage_result(
            db,
            finding,
            confidence_score=payload["confidence_score"],
            rationale=payload["rationale"],
            suggested_action=payload["suggested_action"],
            model_version=LOCAL_MODEL_VERSION,
        )
        return TriageTriggerResponse(
            queued=False,
            ai_triage_enabled=True,
            result={"review_mode": "local", **triage_row_to_api(row)},
        )

    from app.worker.tasks import ai_triage_single_finding

    task = ai_triage_single_finding.delay(finding_id)
    return TriageTriggerResponse(
        queued=True,
        ai_triage_enabled=True,
        result={"task_id": task.id, "review_mode": "llm"},
    )


@router.post("/bulk-triage", response_model=TriageTriggerResponse)
def bulk_triage(
    _rbac: RequireEditor,
    account_id: str | None = Query(default=None),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Triage all un-triaged findings for an org (or a specific account)."""
    from app.services.ai_finding_review import llm_triage_available, org_ai_finding_review_enabled

    org = db.get(Org, uuid.UUID(p["org_id"]))
    if not org_ai_finding_review_enabled(org):
        return TriageTriggerResponse(queued=False, ai_triage_enabled=False)

    if not llm_triage_available():
        return TriageTriggerResponse(
            queued=False,
            ai_triage_enabled=True,
            result={"review_mode": "local", "message": "Bulk triage uses rules-based review per finding in the drawer."},
        )

    if account_id:
        acc = db.get(AwsAccount, uuid.UUID(account_id))
        if not acc or str(acc.org_id) != p["org_id"]:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")

    from app.worker.tasks import ai_triage_task

    org_id = uuid.UUID(p["org_id"])
    accounts = db.scalars(
        select(AwsAccount).where(
            AwsAccount.org_id == org_id,
            AwsAccount.status == "connected",
            *([AwsAccount.id == uuid.UUID(account_id)] if account_id else []),
        )
    ).all()

    task_ids = []
    for acc in accounts:
        task = ai_triage_task.delay(str(acc.id))
        task_ids.append(task.id)

    return TriageTriggerResponse(
        queued=len(accounts) > 0,
        ai_triage_enabled=True,
        result={"task_ids": task_ids, "accounts_queued": len(accounts)},
    )


class RecheckBatchIn(BaseModel):
    finding_ids: list[str]


@router.post("/recheck-batch")
def recheck_batch(body: RecheckBatchIn, _rbac: RequireEditor, p=Depends(current_principal), db: Session = Depends(get_db)):
    from app.services.fast_recheck import try_fast_findings_recheck_batch
    from app.worker.tasks import recheck_finding

    if not body.finding_ids:
        return {"queued": False, "checked": True, "check_id": None, "results": []}

    findings: list[Finding] = []
    acc: AwsAccount | None = None
    check_id: str | None = None
    for fid in body.finding_ids[:50]:
        f = _get_owned(db, p, fid)
        if check_id is None:
            check_id = f.check_id
        elif f.check_id != check_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "all findings must share the same check_id")
        if acc is None:
            acc = db.get(AwsAccount, f.account_id)
            if not acc:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
        elif f.account_id != acc.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "all findings must belong to the same account")
        findings.append(f)

    actor = p.get("sub") or p.get("email") or "system"
    fast = try_fast_findings_recheck_batch(db, account=acc, findings=findings, actor=str(actor))
    if fast is not None:
        return fast

    recheck_finding.delay(str(acc.id), check_id)
    return {"queued": True, "check_id": check_id, "results": []}


@router.post("/{finding_id}/recheck")
def recheck(finding_id: str, _rbac: RequireEditor, p=Depends(current_principal), db: Session = Depends(get_db)):
    from app.services.fast_finding_recheck import try_fast_finding_recheck
    from app.worker.tasks import recheck_finding

    f = _get_owned(db, p, finding_id)
    acc = db.get(AwsAccount, f.account_id)
    if not acc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")

    actor = p.get("sub") or p.get("email") or "system"
    fast = try_fast_finding_recheck(db, account=acc, finding=f, actor=str(actor))
    if fast.get("checked"):
        return fast

    recheck_finding.delay(str(acc.id), f.check_id)
    return {"queued": True, "check_id": f.check_id}
