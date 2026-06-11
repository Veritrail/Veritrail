from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models import AwsAccount
from app.models.resources import BackupPlan

CHECK_ID = "backup.plan.missing"


def run(db: Session, account_id) -> list[FindingDraft]:
    acc = db.get(AwsAccount, account_id)
    if not acc:
        return []

    plan_count = db.scalar(
        select(func.count()).select_from(BackupPlan).where(BackupPlan.account_id == account_id)
    )
    if plan_count and plan_count > 0:
        return []

    aws_account = acc.account_id or "unknown"
    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=f"arn:aws:backup::{aws_account}:account",
            title="No AWS Backup plans configured",
            severity="medium",
            risk_score=score("medium"),
            evidence={
                "plan_count": 0,
                "note": "Create at least one AWS Backup plan to protect critical resources.",
            },
        )
    ]
