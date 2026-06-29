"""Overview metrics for GCP/Azure accounts on the Accounts detail pane."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Control, Finding, Org
from app.models.azure_subscription import AzureDefenderStatus, AzureStorageAccount, AzureSubscription
from app.models.cloud_scan_run import CloudScanRun
from app.models.control import CheckControl
from app.models.gcp_project import GcpComputeInstance, GcpLoggingAudit, GcpProject
from app.services.check_settings import hidden_check_ids
from app.services.compliance_posture import posture_score
from app.services.control_status import compute_control_status
from app.services.evidence_coverage import _dates_in_period, parse_as_of


def _provider_check_prefix(provider: str) -> str:
    if provider == "gcp":
        return "gcp."
    if provider == "azure":
        return "azure."
    raise ValueError(f"unsupported provider: {provider}")


def _scope_column(provider: str) -> str:
    return "gcp_project_id" if provider == "gcp" else "azure_subscription_id"


def _gcp_region_from_zone(zone: str) -> str:
    parts = zone.rsplit("-", 1)
    return parts[0] if len(parts) == 2 and parts[1].isalpha() and len(parts[1]) <= 2 else zone


def count_cloud_resources(db: Session, provider: str, resource_id: uuid.UUID) -> tuple[int, int]:
    """Return (resources_covered, region_count) from latest collector tables."""
    if provider == "gcp":
        compute_rows = db.scalars(
            select(GcpComputeInstance).where(GcpComputeInstance.gcp_project_id == resource_id)
        ).all()
        logging_row = db.scalar(
            select(GcpLoggingAudit).where(GcpLoggingAudit.gcp_project_id == resource_id)
        )
        resources = len(compute_rows) + (1 if logging_row else 0)
        regions = {_gcp_region_from_zone(row.zone) for row in compute_rows if row.zone}
        return resources, len(regions)

    storage_rows = db.scalars(
        select(AzureStorageAccount).where(AzureStorageAccount.azure_subscription_id == resource_id)
    ).all()
    defender_row = db.scalar(
        select(AzureDefenderStatus).where(AzureDefenderStatus.azure_subscription_id == resource_id)
    )
    resources = len(storage_rows) + (1 if defender_row else 0)
    groups = {row.resource_group for row in storage_rows if row.resource_group}
    if defender_row:
        groups.add("defender")
    return resources, len(groups)


def compute_cloud_evidence_coverage(
    db: Session,
    provider: str,
    resource_id: uuid.UUID,
    since: datetime,
    end: datetime,
    period_days: int,
) -> dict:
    """Scan-day coverage for a GCP project or Azure subscription."""
    first_ok = db.scalar(
        select(func.min(CloudScanRun.started_at)).where(
            CloudScanRun.provider == provider,
            CloudScanRun.resource_id == resource_id,
            CloudScanRun.status == "ok",
        )
    )
    successful_in_period = db.scalar(
        select(func.count())
        .select_from(CloudScanRun)
        .where(
            CloudScanRun.provider == provider,
            CloudScanRun.resource_id == resource_id,
            CloudScanRun.status == "ok",
            CloudScanRun.started_at >= since,
            CloudScanRun.started_at <= end,
        )
    ) or 0

    last_failed = db.scalar(
        select(func.max(CloudScanRun.finished_at))
        .select_from(CloudScanRun)
        .where(
            CloudScanRun.provider == provider,
            CloudScanRun.resource_id == resource_id,
            CloudScanRun.status == "error",
            CloudScanRun.started_at >= since,
            CloudScanRun.started_at <= end,
        )
    )

    ok_runs = db.scalars(
        select(CloudScanRun)
        .where(
            CloudScanRun.provider == provider,
            CloudScanRun.resource_id == resource_id,
            CloudScanRun.status == "ok",
            CloudScanRun.started_at >= since,
            CloudScanRun.started_at <= end,
        )
    ).all()

    scan_days: set = set()
    for run in ok_runs:
        ts = run.finished_at or run.started_at
        scan_days.add(ts.date())

    period_dates = set(_dates_in_period(since, end))
    days_with_data = len(scan_days & period_dates)
    missing_dates = sorted(period_dates - scan_days)
    coverage_start = min(scan_days) if scan_days else None

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
        "snapshot_days_in_period": 0,
        "coverage_ratio": round(days_with_data / period_days, 4) if period_days else 0,
        "coverage_label": f"{days_with_data} of {period_days} days with scan data",
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


def _cloud_scan_context(
    db: Session,
    org_id: uuid.UUID,
    provider: str,
    resource_id: uuid.UUID,
    hidden: set[str],
) -> tuple[dict[str, list[Finding]], set[str], set[str], bool]:
    scope_col = _scope_column(provider)
    open_q = select(Finding).where(
        getattr(Finding, scope_col) == resource_id,
        Finding.status == "open",
    )
    if hidden:
        open_q = open_q.where(Finding.check_id.notin_(hidden))

    open_by_check: dict[str, list[Finding]] = {}
    for finding in db.scalars(open_q).all():
        open_by_check.setdefault(finding.check_id, []).append(finding)

    latest_run = db.scalars(
        select(CloudScanRun)
        .where(
            CloudScanRun.provider == provider,
            CloudScanRun.resource_id == resource_id,
            CloudScanRun.status == "ok",
            CloudScanRun.finished_at.isnot(None),
        )
        .order_by(CloudScanRun.finished_at.desc())
        .limit(1)
    ).first()

    latest_checks_run: set[str] = set()
    latest_failed_checks: set[str] = set()
    run_stats = latest_run.stats if latest_run and isinstance(latest_run.stats, dict) else {}
    checks_raw = run_stats.get("checks_run")
    if isinstance(checks_raw, list):
        latest_checks_run = {str(cid) for cid in checks_raw}
    errors_raw = run_stats.get("check_errors")
    if isinstance(errors_raw, list):
        for err in errors_raw:
            if isinstance(err, dict) and err.get("check_id"):
                latest_failed_checks.add(str(err["check_id"]))
            elif isinstance(err, str):
                latest_failed_checks.add(err)

    has_scanned = False
    if provider == "gcp":
        row = db.get(GcpProject, resource_id)
        has_scanned = bool(row and row.org_id == org_id and row.last_scan_at)
    else:
        row = db.get(AzureSubscription, resource_id)
        has_scanned = bool(row and row.org_id == org_id and row.last_scan_at)

    return open_by_check, latest_checks_run, latest_failed_checks, has_scanned


def _soc2_controls_for_provider(db: Session, provider: str) -> list[tuple[Control, list[str]]]:
    prefix = _provider_check_prefix(provider)
    controls = db.scalars(
        select(Control).where(Control.framework == "soc2").order_by(Control.control_id)
    ).all()
    out: list[tuple[Control, list[str]]] = []
    for ctrl in controls:
        check_ids = [
            cid
            for cid in db.scalars(
                select(CheckControl.check_id).where(CheckControl.control_id == ctrl.id)
            ).all()
            if cid.startswith(prefix)
        ]
        if check_ids:
            out.append((ctrl, check_ids))
    return out


def compute_cloud_compliance_posture(
    db: Session,
    org_id: uuid.UUID,
    provider: str,
    resource_id: uuid.UUID,
) -> int | None:
    """Pass rate for SOC 2 controls that include provider-specific checks."""
    org = db.get(Org, org_id)
    hidden = hidden_check_ids(org.settings if org else {})
    open_by_check, latest_checks_run, latest_failed_checks, has_scanned = _cloud_scan_context(
        db, org_id, provider, resource_id, hidden
    )
    if not has_scanned:
        return None

    catalog = _soc2_controls_for_provider(db, provider)
    if not catalog:
        return None

    passed = 0
    failed = 0
    for _ctrl, check_ids in catalog:
        visible = [cid for cid in check_ids if cid not in hidden]
        if not visible:
            continue
        status, _, _ = compute_control_status(
            visible,
            open_by_check,
            latest_checks_run,
            latest_failed_checks,
            has_scanned_account=has_scanned,
        )
        if status == "pass":
            passed += 1
        elif status == "fail":
            failed += 1

    return posture_score(passed=passed, failed=failed)


def build_cloud_posture_trend(
    db: Session,
    org_id: uuid.UUID,
    provider: str,
    resource_id: uuid.UUID,
    *,
    days: int = 14,
) -> list[dict[str, Any]]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    runs = db.scalars(
        select(CloudScanRun)
        .where(
            CloudScanRun.provider == provider,
            CloudScanRun.resource_id == resource_id,
            CloudScanRun.status == "ok",
            CloudScanRun.finished_at.isnot(None),
            CloudScanRun.finished_at >= cutoff,
        )
        .order_by(CloudScanRun.finished_at.asc())
    ).all()

    out: list[dict[str, Any]] = []
    for run in runs:
        ts = run.finished_at or run.started_at
        score: int | None = None
        if isinstance(run.stats, dict) and run.stats.get("posture_score") is not None:
            score = int(run.stats["posture_score"])
        if score is not None:
            out.append({"timestamp": ts.isoformat(), "posture_score": score})
    return out


def build_cloud_account_overview(
    db: Session,
    org_id: uuid.UUID,
    provider: str,
    resource_id: uuid.UUID,
    *,
    period: int = 7,
    as_of: str | None = None,
) -> dict[str, Any]:
    end = parse_as_of(as_of) or datetime.now(timezone.utc)
    since = end - timedelta(days=period)

    resources, regions = count_cloud_resources(db, provider, resource_id)
    coverage = compute_cloud_evidence_coverage(db, provider, resource_id, since, end, period)
    posture = compute_cloud_compliance_posture(db, org_id, provider, resource_id)
    trend = build_cloud_posture_trend(db, org_id, provider, resource_id, days=14)

    return {
        "provider": provider,
        "resource_id": str(resource_id),
        "resources_covered": resources,
        "regions_count": regions,
        "compliance_posture_pct": posture,
        "coverage": coverage,
        "posture_trend": trend,
    }
