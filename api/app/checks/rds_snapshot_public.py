from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.resources import RdsSnapshot

CHECK_ID = "rds.snapshot.public"


def run(db: Session, account_id) -> list[FindingDraft]:
    rows = db.scalars(
        select(RdsSnapshot).where(
            RdsSnapshot.account_id == account_id,
            RdsSnapshot.is_public == True,  # noqa: E712
        )
    ).all()
    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=r.arn,
            title=f"RDS snapshot `{r.snapshot_id}` is publicly restorable",
            severity="critical",
            risk_score=score("critical"),
            evidence={
                "snapshot_id": r.snapshot_id,
                "region": r.region,
                "engine": r.engine,
                "encrypted": r.encrypted,
            },
        )
        for r in rows
    ]
