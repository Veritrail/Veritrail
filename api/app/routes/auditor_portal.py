"""Auditor-scoped read-only routes — findings, controls, evidence, exports."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import current_auditor_principal
from app.models import Finding, AwsAccount, EvidenceSnapshot, EvidenceExport
from app.models.auditor import AuditorAccess, AuditActivityLog
from app.models.control import Control, CheckControl
from app.models.org import Org
from app.services.check_controls import check_control_bundle
from app.services.check_coverage import (
    control_coverage_tier,
    extended_checks_in_list,
    tier_display_label,
    tier_for_check,
)
from app.services.check_evidence import all_evidence_classes, evidence_class_for_check
from app.services.check_settings import hidden_check_ids
from app.services.evidence_pack import build_evidence_pack
from app.services.evidence_coverage import parse_as_of
from app.services.finding_history import finding_open_for_control

router = APIRouter()

FRAMEWORKS = {"soc2", "cis_aws_l1", "iso27001"}


def _log_audit(db: Session, auditor_access_id: str, action: str, resource_type: str, resource_id: str):
    try:
        db.add(AuditActivityLog(
            auditor_access_id=uuid.UUID(auditor_access_id),
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
        ))
        db.commit()
    except Exception:
        pass  # best-effort audit log


def _get_auditor_grant(p, db: Session) -> AuditorAccess:
    auditor_id = p.get("auditor_access_id")
    if not auditor_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid auditor token")
    grant = db.get(AuditorAccess, uuid.UUID(auditor_id))
    if not grant or not grant.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "auditor access revoked or expired")
    return grant


# ── Dashboard Overview ─────────────────────────────────────────────

class AuditorDashboardOut(BaseModel):
    org_name: str
    auditor_name: str | None
    expires_at: str | None
    active_frameworks: list[str]
    connected_accounts: int
    last_scan_at: str | None
    findings_total: int
    findings_by_severity: dict[str, int]
    evidence_snapshot_count: int


@router.get("/dashboard", response_model=AuditorDashboardOut)
def auditor_dashboard(p=Depends(current_auditor_principal), db: Session = Depends(get_db)):
    grant = _get_auditor_grant(p, db)
    org = db.get(Org, grant.org_id)
    org_name = org.name if org else "Unknown"

    # Connected accounts
    accounts = db.scalars(
        select(AwsAccount).where(
            AwsAccount.org_id == grant.org_id,
            AwsAccount.status == "connected",
        )
    ).all()
    last_scan = max((a.last_scan_at for a in accounts if a.last_scan_at), default=None)

    # Findings
    open_findings = db.scalars(
        select(Finding).where(
            Finding.org_id == grant.org_id,
            Finding.status == "open",
        )
    ).all()

    sev_count: dict[str, int] = {}
    for f in open_findings:
        sev_count[f.severity] = sev_count.get(f.severity, 0) + 1

    # Evidence snapshots (count recent)
    snapshot_count = db.scalar(
        select(func.count()).select_from(EvidenceSnapshot).where(
            EvidenceSnapshot.org_id == grant.org_id,
        )
    ) or 0

    _log_audit(db, auditor_access_id=str(grant.id), action="view_dashboard", resource_type="dashboard", resource_id="overview")

    return AuditorDashboardOut(
        org_name=org_name,
        auditor_name=grant.name,
        expires_at=grant.expires_at.isoformat() if grant.expires_at else None,
        active_frameworks=sorted(FRAMEWORKS),
        connected_accounts=len(accounts),
        last_scan_at=last_scan.isoformat() if last_scan else None,
        findings_total=len(open_findings),
        findings_by_severity=sev_count,
        evidence_snapshot_count=snapshot_count,
    )


# ── Findings (Read-Only) ───────────────────────────────────────────

class AuditorFindingOut(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    account_id: str
    check_id: str
    resource_arn: str
    title: str
    severity: str
    risk_score: int
    status: str
    evidence: dict
    first_seen: str
    last_seen: str


def _finding_to_out(f: Finding) -> AuditorFindingOut:
    return AuditorFindingOut(
        id=str(f.id),
        account_id=str(f.account_id),
        check_id=f.check_id,
        resource_arn=f.resource_arn,
        title=f.title,
        severity=f.severity,
        risk_score=f.risk_score,
        status=f.status,
        evidence=f.evidence,
        first_seen=f.first_seen.isoformat() if f.first_seen else "",
        last_seen=f.last_seen.isoformat() if f.last_seen else "",
    )


class AuditorFindingPage(BaseModel):
    items: list[AuditorFindingOut]
    total: int
    next_cursor: str | None


@router.get("/findings", response_model=AuditorFindingPage)
def auditor_findings(
    status_filter: str | None = Query(default=None, alias="status"),
    severity: str | None = None,
    account_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    cursor: str | None = Query(default=None),
    p=Depends(current_auditor_principal),
    db: Session = Depends(get_db),
):
    from app.routes.findings import _encode_cursor, _decode_cursor

    grant = _get_auditor_grant(p, db)

    base_q = select(Finding).where(Finding.org_id == grant.org_id)
    if status_filter and status_filter != "all":
        base_q = base_q.where(Finding.status == status_filter)
    if severity:
        base_q = base_q.where(Finding.severity == severity)
    if account_id:
        base_q = base_q.where(Finding.account_id == uuid.UUID(account_id))

    total = db.scalar(select(func.count()).select_from(base_q.subquery())) or 0

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

    _log_audit(db, auditor_access_id=str(grant.id), action="view_findings", resource_type="finding", resource_id="list")

    return AuditorFindingPage(
        items=[_finding_to_out(f) for f in items],
        total=total,
        next_cursor=next_cursor,
    )


@router.get("/findings/{finding_id}", response_model=AuditorFindingOut)
def auditor_finding_detail(finding_id: str, p=Depends(current_auditor_principal), db: Session = Depends(get_db)):
    grant = _get_auditor_grant(p, db)
    f = db.get(Finding, uuid.UUID(finding_id))
    if not f or str(f.org_id) != str(grant.org_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "finding not found")

    _log_audit(db, auditor_access_id=str(grant.id), action="view_finding", resource_type="finding", resource_id=finding_id)

    return _finding_to_out(f)


# ── Controls / Compliance Matrix ───────────────────────────────────

class AuditorControlOut(BaseModel):
    id: str
    framework: str
    control_id: str
    title: str
    description: str
    check_ids: list[str]
    status: str
    finding_count: int


@router.get("/controls", response_model=list[AuditorControlOut])
def auditor_controls(
    framework: str = Query(...),
    p=Depends(current_auditor_principal),
    db: Session = Depends(get_db),
):
    if framework not in FRAMEWORKS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"framework must be one of {sorted(FRAMEWORKS)}")

    grant = _get_auditor_grant(p, db)

    controls = db.scalars(
        select(Control).where(Control.framework == framework).order_by(Control.control_id)
    ).all()

    # Get first connected account
    acc = db.scalars(
        select(AwsAccount).where(
            AwsAccount.org_id == grant.org_id,
            AwsAccount.status == "connected",
        )
    ).first()
    acc_id = acc.id if acc else None

    open_findings: list[Finding] = []
    if acc_id:
        open_findings = db.scalars(
            select(Finding).where(
                Finding.account_id == acc_id,
                Finding.status == "open",
            )
        ).all()

    open_by_check: dict[str, list[Finding]] = {}
    for f in open_findings:
        open_by_check.setdefault(f.check_id, []).append(f)

    result = []
    for ctrl in controls:
        check_ids = list(
            db.scalars(select(CheckControl.check_id).where(CheckControl.control_id == ctrl.id)).all()
        )
        hits: list[Finding] = []
        for cid in check_ids:
            hits.extend(open_by_check.get(cid, []))

        if not check_ids:
            ctrl_status = "no_data"
        elif any(finding_open_for_control(f, f.status) for f in hits):
            ctrl_status = "fail"
        elif acc_id and acc and acc.last_scan_at:
            ctrl_status = "pass"
        else:
            ctrl_status = "no_data"

        result.append(AuditorControlOut(
            id=str(ctrl.id),
            framework=ctrl.framework,
            control_id=ctrl.control_id,
            title=ctrl.title,
            description=ctrl.description,
            check_ids=check_ids,
            status=ctrl_status,
            finding_count=len(hits),
        ))

    _log_audit(db, auditor_access_id=str(grant.id), action="view_controls", resource_type="control", resource_id=f"framework:{framework}")

    return result


# ── Evidence ───────────────────────────────────────────────────────

class AuditorEvidenceOut(BaseModel):
    id: str
    entity_type: str
    entity_id: str
    taken_at: str
    data: dict


class AuditorEvidencePage(BaseModel):
    items: list[AuditorEvidenceOut]
    total: int
    next_cursor: str | None


@router.get("/evidence", response_model=AuditorEvidencePage)
def auditor_evidence(
    entity_type: str | None = None,
    account_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    cursor: str | None = Query(default=None),
    p=Depends(current_auditor_principal),
    db: Session = Depends(get_db),
):
    from app.routes.findings import _encode_cursor, _decode_cursor

    grant = _get_auditor_grant(p, db)

    base_q = select(EvidenceSnapshot).where(EvidenceSnapshot.org_id == grant.org_id)
    if entity_type:
        base_q = base_q.where(EvidenceSnapshot.entity_type == entity_type)
    if account_id:
        base_q = base_q.where(EvidenceSnapshot.account_id == uuid.UUID(account_id))

    total = db.scalar(select(func.count()).select_from(base_q.subquery())) or 0

    # For evidence, cursor based on taken_at + id (descending)
    q = base_q.order_by(EvidenceSnapshot.taken_at.desc(), EvidenceSnapshot.id.desc())
    if cursor:
        try:
            cur_taken, cur_id = _decode_cursor(cursor)
            from datetime import datetime as _dt
            cur_dt = _dt.fromtimestamp(cur_taken, tz=timezone.utc)
            q = q.where(
                (EvidenceSnapshot.taken_at < cur_dt)
                | ((EvidenceSnapshot.taken_at == cur_dt) & (EvidenceSnapshot.id < cur_id))
            )
        except Exception:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid cursor")

    rows = db.scalars(q.limit(limit + 1)).all()
    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = (
        _encode_cursor(
            int(items[-1].taken_at.timestamp()) if items[-1].taken_at else 0,
            items[-1].id,
        )
        if has_more and items else None
    )

    _log_audit(db, auditor_access_id=str(grant.id), action="view_evidence", resource_type="evidence_snapshot", resource_id="list")

    return AuditorEvidencePage(
        items=[
            AuditorEvidenceOut(
                id=str(s.id),
                entity_type=s.entity_type,
                entity_id=s.entity_id,
                taken_at=s.taken_at.isoformat() if s.taken_at else "",
                data=s.payload_json,
            )
            for s in items
        ],
        total=total,
        next_cursor=next_cursor,
    )


@router.get("/evidence/{evidence_id}", response_model=AuditorEvidenceOut)
def auditor_evidence_detail(evidence_id: str, p=Depends(current_auditor_principal), db: Session = Depends(get_db)):
    grant = _get_auditor_grant(p, db)
    s = db.get(EvidenceSnapshot, uuid.UUID(evidence_id))
    if not s or str(s.org_id) != str(grant.org_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "evidence snapshot not found")

    _log_audit(db, auditor_access_id=str(grant.id), action="view_evidence", resource_type="evidence_snapshot", resource_id=evidence_id)

    return AuditorEvidenceOut(
        id=str(s.id),
        entity_type=s.entity_type,
        entity_id=s.entity_id,
        taken_at=s.taken_at.isoformat() if s.taken_at else "",
        data=s.payload_json,
    )


# ── Export ─────────────────────────────────────────────────────────

@router.get("/export")
def auditor_export(
    framework: str = Query(...),
    account_id: str = Query(...),
    period: int = Query(default=90, ge=7, le=365),
    as_of: str | None = Query(default=None),
    p=Depends(current_auditor_principal),
    db: Session = Depends(get_db),
):
    """Auditor evidence pack download — same pack but logged and with auditor watermark."""
    if framework not in FRAMEWORKS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"framework must be one of {sorted(FRAMEWORKS)}")

    grant = _get_auditor_grant(p, db)

    acc = db.get(AwsAccount, uuid.UUID(account_id))
    if not acc or str(acc.org_id) != str(grant.org_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")

    try:
        pack = build_evidence_pack(
            db=db,
            org_id=grant.org_id,
            account_id=acc.id,
            framework=framework,
            period_days=period,
            as_of=parse_as_of(as_of),
        )
    except Exception as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(exc)) from exc

    zip_bytes = pack.zip_bytes
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"vigil-evidence-{framework}-{ts}-auditor.zip"

    import hashlib
    zip_sha256 = hashlib.sha256(zip_bytes).hexdigest()
    as_of_dt = parse_as_of(as_of)

    db.add(EvidenceExport(
        org_id=grant.org_id,
        account_id=acc.id,
        framework=framework,
        period_days=period,
        as_of=as_of_dt.date() if as_of_dt else None,
        zip_sha256=zip_sha256,
        file_size_bytes=len(zip_bytes),
        report_id=pack.report_id,
        created_by=None,
    ))
    db.commit()

    _log_audit(db, auditor_access_id=str(grant.id), action="download_pack", resource_type="export", resource_id=pack.report_id or "pack")

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-SHA256": zip_sha256,
            "X-Vigil-Pack-SHA256": zip_sha256,
            "X-Vigil-Auditor-Pack": "true",
        },
    )
