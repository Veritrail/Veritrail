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
