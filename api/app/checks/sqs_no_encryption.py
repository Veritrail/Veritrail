from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.resources import SqsQueue

CHECK_ID = "sqs.queue.no_encryption"


def run(db: Session, account_id) -> list[FindingDraft]:
    rows = db.scalars(
        select(SqsQueue).where(
            SqsQueue.account_id == account_id,
            SqsQueue.kms_encrypted == False,  # noqa: E712
        )
    ).all()
    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=getattr(r, "queue_arn"),
            title="SQS queue in `{region}` is not encrypted at rest (SSE-KMS)".format(**{"region": getattr(r, "region")}),
            severity="medium",
            risk_score=score("medium"),
            evidence={"region": getattr(r, "region")},
        )
        for r in rows
    ]
