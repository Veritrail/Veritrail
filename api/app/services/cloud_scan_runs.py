"""Helpers for GCP/Azure cloud scan run lifecycle."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.cloud_scan_run import CloudScanRun
from app.routes.accounts_scan import ScanRunOut


def latest_running_cloud_scan(
    db: Session,
    *,
    provider: str,
    resource_id: uuid.UUID,
    max_age_minutes: int = 30,
) -> CloudScanRun | None:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=max_age_minutes)
    return db.scalar(
        select(CloudScanRun)
        .where(
            CloudScanRun.provider == provider,
            CloudScanRun.resource_id == resource_id,
            CloudScanRun.status == "running",
            CloudScanRun.started_at >= cutoff,
        )
        .order_by(CloudScanRun.started_at.desc())
    )


def latest_cloud_scan(
    db: Session,
    *,
    provider: str,
    resource_id: uuid.UUID,
) -> CloudScanRun | None:
    return db.scalar(
        select(CloudScanRun)
        .where(
            CloudScanRun.provider == provider,
            CloudScanRun.resource_id == resource_id,
        )
        .order_by(CloudScanRun.started_at.desc())
        .limit(1)
    )


def cloud_scan_run_to_out(run: CloudScanRun) -> ScanRunOut:
    stats = run.stats or {}
    duration_seconds = None
    if run.finished_at and run.started_at:
        duration_seconds = round((run.finished_at - run.started_at).total_seconds(), 1)
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
        checks_run_count=stats.get("checks_run_count"),
        check_error_count=stats.get("check_error_count"),
    )
