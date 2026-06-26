"""Unified multi-cloud integration routes (accounts, coverage, scan-all)."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.ratelimit import limiter
from app.core.route_deps import RequireAdmin
from app.core.security import current_principal
from app.models import AwsAccount, ScanRun
from app.models.azure_subscription import AzureSubscription
from app.models.gcp_project import GcpProject
from app.models.org import Org
from app.services.cloud_normalization import build_cloud_coverage, list_cloud_accounts

router = APIRouter()


def _get_org(p, db: Session) -> Org:
    org = db.get(Org, uuid.UUID(p["org_id"]))
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
    return org


class CloudAccountOut(BaseModel):
    provider: str
    id: str
    external_id: str | None = None
    label: str
    status: str
    last_scan_at: datetime | None = None


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


@router.get("/cloud-accounts", response_model=list[CloudAccountOut])
def get_cloud_accounts(p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    return [CloudAccountOut(**row) for row in list_cloud_accounts(db, org.id)]


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
        run_gcp_scan.delay(str(proj.id))
        proj.last_scan_at = datetime.now(timezone.utc)
        queued["gcp"] += 1

    azure_subs = db.scalars(
        select(AzureSubscription).where(
            AzureSubscription.org_id == org_id,
            AzureSubscription.status == "connected",
        )
    ).all()
    for sub in azure_subs:
        run_azure_scan.delay(str(sub.id))
        sub.last_scan_at = datetime.now(timezone.utc)
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
