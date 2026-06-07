from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.resources import S3Bucket

CHECK_ID = "s3.bucket.no_mfa_delete"


def run(db: Session, account_id) -> list[FindingDraft]:
    rows = db.scalars(
        select(S3Bucket).where(
            S3Bucket.account_id == account_id,
            S3Bucket.versioning_enabled == True,  # noqa: E712
            S3Bucket.mfa_delete_enabled == False,  # noqa: E712
        )
    ).all()
    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=getattr(r, "arn"),
            title="S3 bucket `{name}` does not have MFA Delete enabled".format(**{"name": getattr(r, "name")}),
            severity="info",
            risk_score=score("info"),
            evidence={"name": getattr(r, "name")},
        )
        for r in rows
    ]
