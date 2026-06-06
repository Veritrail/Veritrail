from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.resources import EcrRegistrySettings

CHECK_ID = "ecr.registry.enhanced_scanning_disabled"


def run(db: Session, account_id) -> list[FindingDraft]:
    rows = db.scalars(
        select(EcrRegistrySettings).where(
            EcrRegistrySettings.account_id == account_id,
            EcrRegistrySettings.enhanced_scanning_enabled == False,  # noqa: E712
        )
    ).all()
    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=f"arn:aws:ecr:{r.region}::registry",
            title=f"ECR enhanced scanning is not enabled in {r.region}",
            severity="medium",
            risk_score=score("medium"),
            evidence={
                "region": r.region,
                "scan_type": r.scan_type,
                "enhanced_scanning_enabled": r.enhanced_scanning_enabled,
            },
        )
        for r in rows
    ]
