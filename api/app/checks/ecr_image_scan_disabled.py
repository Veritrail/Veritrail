from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.resources import EcrRepository

CHECK_ID = "ecr.repository.image_scan_disabled"


def run(db: Session, account_id) -> list[FindingDraft]:
    rows = db.scalars(
        select(EcrRepository).where(
            EcrRepository.account_id == account_id,
            EcrRepository.scan_on_push == False,  # noqa: E712
        )
    ).all()
    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=r.repository_arn,
            title=f"ECR repository `{r.repository_name}` does not scan images on push",
            severity="medium",
            risk_score=score("medium"),
            evidence={
                "repository_name": r.repository_name,
                "region": r.region,
                "scan_on_push": r.scan_on_push,
                "encryption_type": r.encryption_type,
            },
        )
        for r in rows
    ]
