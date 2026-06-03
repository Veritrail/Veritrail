"""Evidence period coverage — scan and snapshot days in the requested audit window."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException, status

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import EvidenceSnapshot, ScanRun


def parse_as_of(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        d = date.fromisoformat(value[:10])
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "as_of must be YYYY-MM-DD") from exc
    return datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=timezone.utc)


def _dates_in_period(since: datetime, end: datetime) -> list[date]:
    start = since.date()
    finish = end.date()
    days: list[date] = []
    cur = start
    while cur <= finish:
        days.append(cur)
        cur += timedelta(days=1)
    return days


def compute_evidence_coverage(
    db: Session,
    account_id: uuid.UUID,
    since: datetime,
    end: datetime,
    period_days: int,
) -> dict:
    """Return coverage metadata for UI and evidence pack manifest."""
    first_ok = db.scalar(
        select(func.min(ScanRun.started_at)).where(
            ScanRun.account_id == account_id,
            ScanRun.status == "ok",
        )
    )
    successful_in_period = db.scalar(
        select(func.count())
        .select_from(ScanRun)
        .where(
            ScanRun.account_id == account_id,
            ScanRun.status == "ok",
            ScanRun.started_at >= since,
            ScanRun.started_at <= end,
        )
    ) or 0

    last_failed = db.scalar(
        select(func.max(ScanRun.finished_at))
        .select_from(ScanRun)
        .where(
            ScanRun.account_id == account_id,
            ScanRun.status == "error",
            ScanRun.started_at >= since,
            ScanRun.started_at <= end,
        )
    )

    ok_runs = db.scalars(
        select(ScanRun)
        .where(
            ScanRun.account_id == account_id,
            ScanRun.status == "ok",
            ScanRun.started_at >= since,
            ScanRun.started_at <= end,
        )
    ).all()

    scan_days: set[date] = set()
    for run in ok_runs:
        ts = run.finished_at or run.started_at
        scan_days.add(ts.date())

    snapshot_timestamps = db.scalars(
        select(EvidenceSnapshot.taken_at).where(
            EvidenceSnapshot.account_id == account_id,
            EvidenceSnapshot.taken_at >= since,
            EvidenceSnapshot.taken_at <= end,
        )
    ).all()
    snapshot_days = {ts.date() for ts in snapshot_timestamps}

    covered_days = scan_days | snapshot_days
    period_dates = set(_dates_in_period(since, end))
    days_with_data = len(covered_days & period_dates)
    missing_dates = sorted(period_dates - covered_days)

    coverage_start = min(covered_days) if covered_days else None

    gap_sample = [d.isoformat() for d in missing_dates[:30]]
    gap_truncated = len(missing_dates) > 30

    return {
        "period_days": period_days,
        "period_start": since.isoformat(),
        "period_end": end.isoformat(),
        "first_successful_scan_at": first_ok.isoformat() if first_ok else None,
        "coverage_start": (
            datetime.combine(coverage_start, datetime.min.time(), tzinfo=timezone.utc).isoformat()
            if coverage_start
            else None
        ),
        "days_with_data": days_with_data,
        "days_requested": period_days,
        "successful_scans_in_period": successful_in_period,
        "scan_days_in_period": len(scan_days),
        "snapshot_days_in_period": len(snapshot_days),
        "coverage_ratio": round(days_with_data / period_days, 4) if period_days else 0,
        "coverage_label": f"{days_with_data} of {period_days} days with scan or snapshot data",
        "coverage_gaps": gap_sample,
        "coverage_gaps_truncated": gap_truncated,
        "coverage_gaps_total": len(missing_dates),
        "last_failed_scan_at": last_failed.isoformat() if last_failed else None,
        "warning": (
            "Extend monitoring to cover the Type II audit period."
            if days_with_data < period_days
            else None
        ),
    }
