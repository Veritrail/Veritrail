"""Check: active IAM access key older than 90 days (rotation hygiene)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.core.sensitive_display import mask_access_key_id
from app.models import IamAccessKey

CHECK_ID = "iam.access_key.no_rotation_90d"
THRESHOLD_DAYS = 90


def run(db: Session, account_id) -> list[FindingDraft]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=THRESHOLD_DAYS)
    rows = db.scalars(
        select(IamAccessKey).where(
            IamAccessKey.account_id == account_id,
            IamAccessKey.status == "Active",
            IamAccessKey.created < cutoff,
        )
    ).all()

    out: list[FindingDraft] = []
    for k in rows:
        age_days = (datetime.now(timezone.utc) - k.created).days
        username = k.user_arn.split("/")[-1]
        out.append(
            FindingDraft(
                check_id=CHECK_ID,
                resource_arn=k.user_arn,
                title=f"Access key `{mask_access_key_id(k.key_id)}` for `{username}` is {age_days} days old",
                severity="medium",
                risk_score=score("medium", age_days=age_days),
                evidence={
                    "key_id": k.key_id,
                    "user_arn": k.user_arn,
                    "created": k.created.isoformat(),
                    "last_used": k.last_used.isoformat() if k.last_used else None,
                    "age_days": age_days,
                    "threshold_days": THRESHOLD_DAYS,
                },
            )
        )
    return out
