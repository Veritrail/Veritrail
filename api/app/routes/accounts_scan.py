import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.ratelimit import limiter
from app.core.security import current_principal
from app.core.route_deps import RequireAdmin
from app.models import AwsAccount, AssumeRoleAudit, ScanRun

router = APIRouter()


class ScanRunOut(BaseModel):
    id: str
    status: str
    started_at: str
    finished_at: str | None
    error: str | None
    failed_at: str | None = None  # which collector/phase failed (from stats.failed_at)
    error_type: str | None = None  # exception class name
    findings_opened: int
    findings_resolved: int
    progress_step: int | None = None  # worker step counter (from stats._progress_step)
    progress_total: int | None = None  # total steps (from stats._progress_total)
    progress_phase: int | None = None  # current UI phase index 0-5 (from stats._progress_phase)
    progress_step_name: str | None = None  # worker step label (from stats._progress_step_name)
    progress_collector_index: int | None = None  # 1-based collector index (from stats._progress_collector_index)
    progress_collector_total: int | None = None  # collector count (from stats._progress_collector_total)
    duration_seconds: float | None = None
    checks_run_count: int | None = None
    check_error_count: int | None = None
    resources_collected: int | None = None
    regions_collected: int | None = None


class ScanStatsOut(BaseModel):
    scans_last_7_days: int
    scans_prev_7_days: int


@router.get("/scan-stats", response_model=ScanStatsOut)
def scan_stats(p=Depends(current_principal), db: Session = Depends(get_db)):
    """Count scan runs started in the last 7 / prior 7 days across the org."""
    org_id = uuid.UUID(p["org_id"])
    now = datetime.now(timezone.utc)
    last_7_start = now - timedelta(days=7)
    prev_7_start = now - timedelta(days=14)

    account_ids = list(
        db.scalars(select(AwsAccount.id).where(AwsAccount.org_id == org_id)).all()
    )
    if not account_ids:
        return ScanStatsOut(scans_last_7_days=0, scans_prev_7_days=0)

    def _count_between(start: datetime, end: datetime) -> int:
        return (
            db.scalar(
                select(func.count())
                .select_from(ScanRun)
                .where(
                    ScanRun.account_id.in_(account_ids),
                    ScanRun.started_at >= start,
                    ScanRun.started_at < end,
                )
            )
            or 0
        )

    return ScanStatsOut(
        scans_last_7_days=_count_between(last_7_start, now),
        scans_prev_7_days=_count_between(prev_7_start, last_7_start),
    )


@router.post("/scan-all")
@limiter.limit("3/hour")
def trigger_scan_all(request: Request, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    """Queue a scan for every connected account in the org."""
    from app.worker.tasks import run_scan

    org_id = uuid.UUID(p["org_id"])
    accounts = db.scalars(
        select(AwsAccount).where(AwsAccount.org_id == org_id, AwsAccount.status == "connected")
    ).all()
    if not accounts:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no connected accounts")

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
    queued: list[str] = []
    deduped: list[str] = []
    for acc in accounts:
        existing = db.scalar(
            select(ScanRun)
            .where(ScanRun.account_id == acc.id)
            .where(ScanRun.status == "running")
            .where(ScanRun.started_at >= cutoff)
            .order_by(ScanRun.started_at.desc())
        )
        if existing:
            deduped.append(str(existing.id))
            continue
        job = run_scan.delay(str(acc.id))
        queued.append(job.id)

    return {"queued": len(queued), "deduped": len(deduped), "account_count": len(accounts)}


@router.post("/{account_id}/scan")
@limiter.limit("3/hour")
def trigger_scan(account_id: str, request: Request, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    from app.worker.tasks import run_scan
    acc = db.get(AwsAccount, uuid.UUID(account_id))
    if not acc or str(acc.org_id) != p["org_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
    if acc.status != "connected":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "account not connected")

    # Dedup: if a scan is already running for this account and started within the
    # last 30 min, return that one instead of queueing a duplicate. Older runs
    # are presumed stuck (worker restart, etc.) and a fresh scan is allowed.
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
    existing = db.scalar(
        select(ScanRun)
        .where(ScanRun.account_id == acc.id)
        .where(ScanRun.status == "running")
        .where(ScanRun.started_at >= cutoff)
        .order_by(ScanRun.started_at.desc())
    )
    if existing:
        return {"job_id": str(existing.id), "deduped": True}

    job = run_scan.delay(str(acc.id))
    return {"job_id": job.id}


@router.get("/{account_id}/scan-runs/latest", response_model=ScanRunOut | None)
def latest_scan_run(account_id: str, p=Depends(current_principal), db: Session = Depends(get_db)):
    acc = db.get(AwsAccount, uuid.UUID(account_id))
    if not acc or str(acc.org_id) != p["org_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
    run = db.scalar(
        select(ScanRun)
        .where(ScanRun.account_id == acc.id)
        .order_by(ScanRun.started_at.desc())
        .limit(1)
    )
    if not run:
        return None
    stats = run.stats or {}
    duration_seconds = None
    if run.finished_at and run.started_at:
        duration_seconds = round((run.finished_at - run.started_at).total_seconds(), 1)
    checks_run = stats.get("checks_run") if isinstance(stats.get("checks_run"), list) else []
    check_errors = stats.get("check_errors") if isinstance(stats.get("check_errors"), list) else []
    return ScanRunOut(
        id=str(run.id),
        status=run.status,
        started_at=run.started_at.isoformat(),
        finished_at=run.finished_at.isoformat() if run.finished_at else None,
        error=run.error,
        failed_at=stats.get("failed_at"),
        error_type=stats.get("error_type"),
        findings_opened=run.findings_opened or 0,
        findings_resolved=run.findings_resolved or 0,
        progress_step=stats.get("_progress_step"),
        progress_total=stats.get("_progress_total"),
        progress_phase=stats.get("_progress_phase"),
        progress_step_name=stats.get("_progress_step_name"),
        progress_collector_index=stats.get("_progress_collector_index"),
        progress_collector_total=stats.get("_progress_collector_total"),
        duration_seconds=duration_seconds,
        checks_run_count=len(checks_run) if checks_run else None,
        check_error_count=len(check_errors) if check_errors else None,
    )


class AssumeRoleAuditOut(BaseModel):
    id: str
    called_at: str
    purpose: str | None
    session_name: str | None
    success: bool
    error_code: str | None
    error_message: str | None


@router.get("/{account_id}/assume-role-audit", response_model=list[AssumeRoleAuditOut])
def assume_role_audit(
    account_id: str,
    limit: int = Query(100, ge=1, le=500),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Customer-facing audit log: every sts:AssumeRole Veritrail made against this account.

    Returns the most recent `limit` events newest-first. Read-only.
    """
    acc = db.get(AwsAccount, uuid.UUID(account_id))
    if not acc or str(acc.org_id) != p["org_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
    rows = db.scalars(
        select(AssumeRoleAudit)
        .where(AssumeRoleAudit.aws_account_id == acc.id)
        .order_by(AssumeRoleAudit.called_at.desc())
        .limit(limit)
    ).all()
    return [
        AssumeRoleAuditOut(
            id=str(r.id),
            called_at=r.called_at.isoformat(),
            purpose=r.purpose,
            session_name=r.session_name,
            success=r.success,
            error_code=r.error_code,
            error_message=r.error_message,
        )
        for r in rows
    ]


