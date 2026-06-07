from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.resources import DynamoDbTable

CHECK_ID = "dynamodb.table.no_encryption"


def run(db: Session, account_id) -> list[FindingDraft]:
    rows = db.scalars(
        select(DynamoDbTable).where(
            DynamoDbTable.account_id == account_id,
            DynamoDbTable.kms_encrypted == False,  # noqa: E712
        )
    ).all()
    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=getattr(r, "arn"),
            title="DynamoDB table `{table_name}` is not encrypted with a customer-managed KMS key (CMK)".format(**{"table_name": getattr(r, "table_name")}),
            severity="medium",
            risk_score=score("medium"),
            evidence={"table_name": getattr(r, "table_name")},
        )
        for r in rows
    ]
