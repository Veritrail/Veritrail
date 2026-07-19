"""Unified multi-cloud integration routes (accounts, coverage, scan-all)."""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.org_context import resolve_org
from app.core.ratelimit import limiter
from app.core.route_deps import RequireAdmin
from app.core.security import current_principal
from app.models import AwsAccount, ScanRun
from app.models.azure_subscription import AzureSubscription
from app.models.gcp_project import GcpProject
from app.models.org import Org
from app.routes.accounts_scan import ScanRunOut
from app.services.cloud_normalization import build_cloud_coverage, list_cloud_accounts
from app.services.cloud_account_overview import build_cloud_account_overview
from app.services.cloud_scan_runs import (
    cloud_scan_run_to_out,
    latest_cloud_scan,
    latest_running_cloud_scan,
    list_cloud_scans,
)

router = APIRouter()


def _get_org(p, db: Session) -> Org:
    return resolve_org(db, p)


class CloudAccountOut(BaseModel):
    provider: str
    id: str
    external_id: str | None = None
    label: str
    status: str
    last_scan_at: datetime | None = None
    last_error: str | None = None
    open_findings_count: int = 0


class CloudCoverageProviderOut(BaseModel):
    provider: str
    connected_count: int
    open_findings_count: int
    last_scan_at: datetime | None = None


class CloudCoverageOut(BaseModel):
    providers: list[CloudCoverageProviderOut]
    total_connected: int
    total_open_findings: int


class CloudScanAllOut(BaseModel):
    queued: dict[str, int]
    skipped: dict[str, int]
    message: str


class CloudAccountOverviewOut(BaseModel):
    provider: str
    resource_id: str
    resources_covered: int
    regions_count: int
    open_findings_count: int = 0
    soc2_controls_passed: int | None = None
    soc2_controls_total: int | None = None
    compliance_posture_pct: int | None = None
    coverage: dict
    posture_trend: list[dict]
    open_findings_trend: list[dict] = []


@router.get("/cloud-accounts", response_model=list[CloudAccountOut])
def get_cloud_accounts(p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    return [CloudAccountOut(**row) for row in list_cloud_accounts(db, org.id)]


@router.get("/cloud-accounts/{provider}/{resource_id}/scan-runs", response_model=list[ScanRunOut])
def list_cloud_scan_runs(
    provider: str,
    resource_id: uuid.UUID,
    limit: int = Query(3, ge=1, le=20),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    if provider not in {"gcp", "azure"}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "cloud account not found")
    if provider == "gcp":
        row = db.get(GcpProject, resource_id)
    else:
        row = db.get(AzureSubscription, resource_id)
    if not row or row.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "cloud account not found")
    runs = list_cloud_scans(db, provider=provider, resource_id=resource_id, limit=limit)
    return [cloud_scan_run_to_out(run) for run in runs]


@router.get("/cloud-accounts/{provider}/{resource_id}/scan-runs/latest", response_model=ScanRunOut | None)
def latest_cloud_scan_run(
    provider: str,
    resource_id: uuid.UUID,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    if provider not in {"gcp", "azure"}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "cloud account not found")
    if provider == "gcp":
        row = db.get(GcpProject, resource_id)
    else:
        row = db.get(AzureSubscription, resource_id)
    if not row or row.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "cloud account not found")
    run = latest_cloud_scan(db, provider=provider, resource_id=resource_id)
    if not run:
        return None
    return cloud_scan_run_to_out(run)


@router.get("/cloud-accounts/{provider}/{resource_id}/overview", response_model=CloudAccountOverviewOut)
def get_cloud_account_overview(
    provider: str,
    resource_id: uuid.UUID,
    period: int = Query(default=7, ge=7, le=365),
    as_of: str | None = Query(default=None, description="End of audit period (YYYY-MM-DD)"),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    if provider not in {"gcp", "azure"}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "cloud account not found")
    if provider == "gcp":
        row = db.get(GcpProject, resource_id)
    else:
        row = db.get(AzureSubscription, resource_id)
    if not row or row.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "cloud account not found")

    payload = build_cloud_account_overview(
        db,
        org.id,
        provider,
        resource_id,
        period=period,
        as_of=as_of,
    )
    return CloudAccountOverviewOut(**payload)


@router.get("/cloud-coverage", response_model=CloudCoverageOut)
def get_cloud_coverage(p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    payload = build_cloud_coverage(db, org.id)
    return CloudCoverageOut(**payload)


@router.post("/cloud-scan-all", response_model=CloudScanAllOut)
@limiter.limit("3/hour")
def trigger_cloud_scan_all(
    request: Request,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Queue scans for every connected AWS account, GCP project, and Azure subscription."""
    from app.worker.tasks import run_azure_scan, run_gcp_scan, run_scan

    org_id = uuid.UUID(p["org_id"])
    queued = {"aws": 0, "gcp": 0, "azure": 0}
    skipped = {"aws": 0, "gcp": 0, "azure": 0}
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)

    aws_accounts = db.scalars(
        select(AwsAccount).where(AwsAccount.org_id == org_id, AwsAccount.status == "connected")
    ).all()
    for acc in aws_accounts:
        existing = db.scalar(
            select(ScanRun)
            .where(ScanRun.account_id == acc.id)
            .where(ScanRun.status == "running")
            .where(ScanRun.started_at >= cutoff)
            .order_by(ScanRun.started_at.desc())
        )
        if existing:
            skipped["aws"] += 1
            continue
        run_scan.delay(str(acc.id))
        queued["aws"] += 1

    gcp_projects = db.scalars(
        select(GcpProject).where(GcpProject.org_id == org_id, GcpProject.status == "connected")
    ).all()
    for proj in gcp_projects:
        existing = latest_running_cloud_scan(db, provider="gcp", resource_id=proj.id)
        if existing:
            skipped["gcp"] += 1
            continue
        run_gcp_scan.delay(str(proj.id))
        queued["gcp"] += 1

    azure_subs = db.scalars(
        select(AzureSubscription).where(
            AzureSubscription.org_id == org_id,
            AzureSubscription.status == "connected",
        )
    ).all()
    for sub in azure_subs:
        existing = latest_running_cloud_scan(db, provider="azure", resource_id=sub.id)
        if existing:
            skipped["azure"] += 1
            continue
        run_azure_scan.delay(str(sub.id))
        queued["azure"] += 1

    if sum(queued.values()) == 0 and sum(skipped.values()) == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no connected cloud accounts to scan")

    db.commit()
    total = sum(queued.values())
    return CloudScanAllOut(
        queued=queued,
        skipped=skipped,
        message=f"Queued {total} cloud scan(s)",
    )
