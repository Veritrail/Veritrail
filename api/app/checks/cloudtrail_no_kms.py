from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.resources import CloudTrailTrail

CHECK_ID = "cloudtrail.trail.no_kms"


def run(db: Session, account_id) -> list[FindingDraft]:
    trails = db.scalars(
        select(CloudTrailTrail).where(
            CloudTrailTrail.account_id == account_id,
            CloudTrailTrail.is_logging == True,  # noqa: E712
            CloudTrailTrail.kms_key_id.is_(None),
        )
    ).all()

    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=t.arn,
            title=f"CloudTrail trail `{t.name}` is not encrypted with a customer-managed KMS key (CMK)",
            severity="medium",
            risk_score=score("medium"),
            evidence={"trail_name": t.name, "home_region": t.home_region},
        )
        for t in trails
    ]
