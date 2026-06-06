from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.resources import InspectorFinding

CHECK_ID = "aws.inspector.active_critical_finding"


def run(db: Session, account_id) -> list[FindingDraft]:
    rows = db.scalars(
        select(InspectorFinding).where(
            InspectorFinding.account_id == account_id,
            InspectorFinding.severity == "CRITICAL",
        )
    ).all()
    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=r.finding_arn,
            title=r.title or "Active critical Inspector finding",
            severity="critical",
            risk_score=score("critical"),
            evidence={
                "region": r.region,
                "resource_type": r.resource_type,
                "resource_id": r.resource_id,
                "severity": r.severity,
                "fix_available": r.fix_available,
            },
        )
        for r in rows
    ]
