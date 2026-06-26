"""Evidence coverage summary by compliance category (automated vs external)."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.evidence_artifact import EvidenceArtifact
from app.models.org import Org
from app.services.composite_controls import list_composite_controls
from app.services.evidence_gap import open_absence_gap_check_ids
from app.services.coverage_overrides import get_coverage_overrides
from app.services.evidence_source_registry import (
    EVIDENCE_SOURCE_CATEGORIES,
    EXTERNAL_EVIDENCE_ONLY_CATEGORY_KEYS,
)
from app.services.evidence_source_store import load_evidence_sources

_STATUS_PRIORITY = {"fail": 0, "no_data": 1, "pass": 2}


def _artifact_is_stale(row: EvidenceArtifact, today: date) -> bool:
    if row.status == "rejected":
        return False
    for field in (row.expires_at, row.period_end):
        if field and field < today:
            return True
    return False


def _composite_display_status(
    composite: dict[str, Any],
    *,
    has_accepted: bool,
    open_by_check: dict[str, list],
) -> str:
    status = composite.get("status")
    if status == "pass":
        return "passing"
    if status == "no_data":
        return "unevaluated"
    if status == "fail" and has_accepted:
        return "externally_covered"
    check_ids = composite.get("check_ids") or []
    if status == "fail" and not has_accepted and open_absence_gap_check_ids(check_ids, open_by_check):
        return "needs_evidence"
    failing_checks = [cid for cid in check_ids if open_by_check.get(cid)]
    if not failing_checks:
        return "failing"
    tiers = composite.get("check_tiers") or {}
    has_core = any(tiers.get(cid, "core") == "core" for cid in failing_checks)
    return "failing" if has_core else "at_risk"


def _worst_scan_status(statuses: list[str]) -> str:
    if not statuses:
        return "no_data"
    return min(statuses, key=lambda s: _STATUS_PRIORITY.get(s, 99))


def _external_evidence_category_status(
    cat_key: str,
    *,
    display_status: str,
    has_accepted: bool,
    registry_vendor: str | None,
) -> str:
    """Employee endpoints and MDM cannot pass from AWS scans alone."""
    if cat_key not in EXTERNAL_EVIDENCE_ONLY_CATEGORY_KEYS:
        return display_status
    if display_status in ("out_of_scope", "not_applicable"):
        return display_status
    if cat_key == "mdm_endpoint":
        if has_accepted and registry_vendor:
            return "externally_covered"
        return "needs_evidence"
    # endpoint_security
    if has_accepted:
        return "externally_covered"
    if display_status in ("passing", "unevaluated", "failing", "at_risk"):
        return "needs_evidence"
    return display_status


def build_category_evidence_coverage(
    db: Session,
    *,
    org_id: uuid.UUID,
    framework: str,
    account_id: uuid.UUID | None,
) -> dict[str, Any]:
    org = db.get(Org, org_id)
    registry = load_evidence_sources(db, org_id)
    coverage_overrides = get_coverage_overrides(org.settings if org else {})
    composites = list_composite_controls(db, org_id, account_id)
    by_id = {row["id"]: row for row in composites}

    from app.services.composite_controls import _scan_context
    from app.services.check_settings import hidden_check_ids

    hidden = hidden_check_ids(org.settings if org else {})
    open_by_check, *_ = _scan_context(db, org_id, account_id, hidden)

    artifacts = db.scalars(
        select(EvidenceArtifact).where(
            EvidenceArtifact.org_id == org_id,
            EvidenceArtifact.framework == framework,
        )
    ).all()
    today = datetime.now(timezone.utc).date()

    accepted_by_composite: dict[str, int] = {}
    submitted_by_composite: dict[str, int] = {}
    stale_by_composite: dict[str, int] = {}
    for art in artifacts:
        cid = art.composite_control_id
        if not cid:
            continue
        if art.status == "accepted":
            accepted_by_composite[cid] = accepted_by_composite.get(cid, 0) + 1
            if _artifact_is_stale(art, today):
                stale_by_composite[cid] = stale_by_composite.get(cid, 0) + 1
        elif art.status == "submitted":
            submitted_by_composite[cid] = submitted_by_composite.get(cid, 0) + 1

    categories_out: list[dict[str, Any]] = []
    summary_counts: dict[str, int] = {
        "automated_passing": 0,
        "needs_evidence": 0,
        "externally_covered": 0,
        "failing": 0,
        "at_risk": 0,
        "unevaluated": 0,
        "out_of_scope": 0,
        "not_applicable": 0,
    }

    for cat in EVIDENCE_SOURCE_CATEGORIES:
        composite_ids = list(cat["composite_ids"])
        member_rows = [by_id[cid] for cid in composite_ids if cid in by_id]
        scan_status = _worst_scan_status([r["status"] for r in member_rows])
        primary_id = composite_ids[0] if composite_ids else None
        primary = by_id.get(primary_id) if primary_id else (member_rows[0] if member_rows else None)

        accepted = sum(accepted_by_composite.get(cid, 0) for cid in composite_ids)
        submitted = sum(submitted_by_composite.get(cid, 0) for cid in composite_ids)
        stale = sum(stale_by_composite.get(cid, 0) for cid in composite_ids)
        has_accepted = accepted > 0

        display_status = "unevaluated"
        override = next(
            (coverage_overrides.get(cid) for cid in composite_ids if coverage_overrides.get(cid)),
            None,
        )
        if override:
            display_status = override
        elif primary:
            display_status = _composite_display_status(
                primary,
                has_accepted=has_accepted,
                open_by_check=open_by_check,
            )

        entry = registry.get(cat["key"])
        registry_vendor = entry.get("vendor") if entry else None
        display_status = _external_evidence_category_status(
            cat["key"],
            display_status=display_status,
            has_accepted=has_accepted,
            registry_vendor=registry_vendor,
        )

        if display_status in summary_counts:
            summary_counts[display_status] += 1
        elif display_status == "passing":
            summary_counts["automated_passing"] += 1

        categories_out.append(
            {
                "key": cat["key"],
                "label": cat["label"],
                "composite_ids": composite_ids,
                "primary_composite_id": primary_id if primary else None,
                "scan_status": scan_status,
                "display_status": display_status,
                "registry_vendor": registry_vendor,
                "accepted_artifacts": accepted,
                "submitted_artifacts": submitted,
                "stale_artifacts": stale,
            }
        )

    from app.services.evidence_artifact_storage import storage_backend_label

    return {
        "framework": framework,
        "summary": summary_counts,
        "categories": categories_out,
        "storage_backend": storage_backend_label(),
    }
