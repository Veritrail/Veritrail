from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.resources import SnsTopic

CHECK_ID = "sns.topic.no_encryption"


def run(db: Session, account_id) -> list[FindingDraft]:
    rows = db.scalars(
        select(SnsTopic).where(
            SnsTopic.account_id == account_id,
            SnsTopic.kms_encrypted == False,  # noqa: E712
        )
    ).all()
    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=getattr(r, "topic_arn"),
            title="SNS topic in `{region}` is not encrypted with a customer-managed KMS key (CMK)".format(**{"region": getattr(r, "region")}),
            severity="medium",
            risk_score=score("medium"),
            evidence={"region": getattr(r, "region")},
        )
        for r in rows
    ]
