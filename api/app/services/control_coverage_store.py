"""Sync evidence_requirements and control_coverages from composite + control state."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.phase9 import ControlCoverage, EvidenceRequirement
from app.services.evidence_source_registry import EVIDENCE_SOURCE_CATEGORIES


def _requirement_rows_for_framework(framework: str) -> list[dict[str, Any]]:
    from app.services.composite_controls import composite_control_definitions

    rows: list[dict[str, Any]] = []
    cat_by_composite: dict[str, str] = {}
    for cat in EVIDENCE_SOURCE_CATEGORIES:
        for cid in cat["composite_ids"]:
            cat_by_composite[cid] = cat["key"]

    for comp in composite_control_definitions():
        composite_id = comp["id"]
        check_ids = comp.get("checks") or []
        category_key = cat_by_composite.get(composite_id)
        source = "external" if not check_ids else "automated"
        rows.append(
            {
                "composite_control_id": composite_id,
                "requirement_key": "primary_checks",
                "label": comp.get("title") or composite_id,
                "source": source,
                "category_key": category_key,
            }
        )
        if category_key in ("hr_training", "vendor_risk", "mdm_endpoint", "endpoint_security"):
            rows.append(
                {
                    "composite_control_id": composite_id,
                    "requirement_key": "accepted_artifact",
                    "label": f"Accepted external evidence for {comp.get('title', composite_id)}",
                    "source": "external",
                    "category_key": category_key,
                }
            )
    return rows


def sync_evidence_requirements(db: Session, org_id: uuid.UUID, framework: str) -> int:
    """Upsert requirement catalog for an org/framework from composites."""
    now = datetime.now(timezone.utc)
    templates = _requirement_rows_for_framework(framework)
    count = 0
    for tpl in templates:
        row = db.scalar(
            select(EvidenceRequirement).where(
                EvidenceRequirement.org_id == org_id,
                EvidenceRequirement.framework == framework,
                EvidenceRequirement.composite_control_id == tpl["composite_control_id"],
                EvidenceRequirement.requirement_key == tpl["requirement_key"],
            )
        )
        if not row:
            row = EvidenceRequirement(
                id=uuid.uuid4(),
                org_id=org_id,
                framework=framework,
                composite_control_id=tpl["composite_control_id"],
                requirement_key=tpl["requirement_key"],
                label=tpl["label"],
                source=tpl["source"],
                category_key=tpl.get("category_key"),
            )
            db.add(row)
            count += 1
        else:
            row.label = tpl["label"]
            row.source = tpl["source"]
            row.category_key = tpl.get("category_key")
            row.updated_at = now
    db.flush()
    return count


def sync_control_coverages(
    db: Session,
    org_id: uuid.UUID,
    account_id: uuid.UUID,
    framework: str,
    control_results: list[dict[str, Any]],
) -> int:
    """Persist per-control coverage rows from pack/control evaluation."""
    now = datetime.now(timezone.utc)
    db.execute(
        delete(ControlCoverage).where(
            ControlCoverage.org_id == org_id,
            ControlCoverage.account_id == account_id,
            ControlCoverage.framework == framework,
        )
    )
    count = 0
    for cr in control_results:
        status = cr.get("status") or "no_data"
        coverage_source = "scan" if cr.get("finding_count") else "composite"
        row = ControlCoverage(
            id=uuid.uuid4(),
            org_id=org_id,
            account_id=account_id,
            framework=framework,
            control_id=cr["control_id"],
            status=status,
            coverage_source=coverage_source,
            details={
                "title": cr.get("title"),
                "finding_count": cr.get("finding_count"),
                "exception_count": cr.get("exception_count"),
                "coverage_tier": cr.get("coverage_tier"),
            },
            updated_at=now,
        )
        db.add(row)
        count += 1
    db.flush()
    return count


def sync_coverages_after_scan(
    db: Session,
    org_id: uuid.UUID,
    account_id: uuid.UUID,
    *,
    framework: str = "soc2",
    checks_run: set[str] | list[str] | None = None,
    check_errors: list[dict[str, Any]] | None = None,
) -> int:
    """Lightweight post-scan coverage sync (no evidence pack / snapshots).

    Builds control_results from open findings + latest checks_run, then upserts
    evidence_requirements and control_coverages for the account/framework.
    """
    from app.models import AwsAccount, CheckControl, Control, Finding, ScanRun
    from app.models.org import Org
    from app.services.check_settings import hidden_check_ids
    from app.services.control_status import compute_control_status
    from app.services.org_control_mappings import load_org_mapping_index
    from app.services.seed_controls import effective_checks_for_control_row

    sync_evidence_requirements(db, org_id, framework)

    org = db.get(Org, org_id)
    hidden = hidden_check_ids(org.settings if org else {})
    mapping_index = load_org_mapping_index(db, org_id)

    controls = db.scalars(
        select(Control).where(Control.framework == framework).order_by(Control.control_id)
    ).all()

    open_q = select(Finding).where(Finding.account_id == account_id, Finding.status == "open")
    if hidden:
        open_q = open_q.where(Finding.check_id.notin_(hidden))
    open_findings = db.scalars(open_q).all()
    open_by_check: dict[str, list[Finding]] = {}
    for f in open_findings:
        open_by_check.setdefault(f.check_id, []).append(f)

    latest_checks_run: set[str] = set(str(c) for c in (checks_run or []))
    latest_failed_checks: set[str] = set()
    if check_errors:
        for err in check_errors:
            cid = err.get("check_id") if isinstance(err, dict) else None
            if cid:
                latest_failed_checks.add(str(cid))
    if not latest_checks_run:
        latest_run = db.scalars(
            select(ScanRun)
            .where(
                ScanRun.account_id == account_id,
                ScanRun.status.in_(("ok", "degraded")),
                ScanRun.finished_at.isnot(None),
            )
            .order_by(ScanRun.finished_at.desc())
            .limit(1)
        ).first()
        run_stats = latest_run.stats if latest_run and isinstance(latest_run.stats, dict) else {}
        raw = run_stats.get("checks_run") if isinstance(run_stats, dict) else None
        if isinstance(raw, list):
            latest_checks_run = {str(cid) for cid in raw}
        errors_raw = run_stats.get("check_errors") if isinstance(run_stats, dict) else None
        if isinstance(errors_raw, list):
            for err in errors_raw:
                if isinstance(err, dict) and err.get("check_id"):
                    latest_failed_checks.add(str(err["check_id"]))

    acc = db.get(AwsAccount, account_id)
    has_scanned = bool(acc and acc.last_scan_at) or bool(latest_checks_run)

    control_results: list[dict[str, Any]] = []
    for ctrl in controls:
        links = db.scalars(select(CheckControl.check_id).where(CheckControl.control_id == ctrl.id)).all()
        check_ids = effective_checks_for_control_row(
            db, org_id, ctrl, list(links), mapping_index=mapping_index
        )
        status, hits, finding_count = compute_control_status(
            check_ids,
            open_by_check,
            latest_checks_run,
            latest_failed_checks,
            has_scanned_account=has_scanned,
        )
        control_results.append(
            {
                "control_id": ctrl.control_id,
                "title": ctrl.title,
                "status": status,
                "finding_count": finding_count if finding_count else len(hits),
            }
        )

    return sync_control_coverages(db, org_id, account_id, framework, control_results)
