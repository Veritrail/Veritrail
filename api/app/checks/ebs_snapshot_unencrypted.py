from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.resources import EbsSnapshot

CHECK_ID = "ec2.ebs.snapshot_unencrypted"


def run(db: Session, account_id) -> list[FindingDraft]:
    rows = db.scalars(
        select(EbsSnapshot).where(
            EbsSnapshot.account_id == account_id,
            EbsSnapshot.encrypted == False,  # noqa: E712
        )
    ).all()
    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=getattr(r, "arn"),
            title="EBS snapshot `{snapshot_id}` is not encrypted".format(**{"snapshot_id": getattr(r, "snapshot_id")}),
            severity="medium",
            risk_score=score("medium"),
            evidence={"snapshot_id": getattr(r, "snapshot_id")},
        )
        for r in rows
    ]
