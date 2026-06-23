from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.resources import IdentityCenterUser

CHECK_ID = "identity_center.user.inactive_90d"
THRESHOLD_DAYS = 90


def run(db: Session, account_id) -> list[FindingDraft]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=THRESHOLD_DAYS)
    rows = db.scalars(
        select(IdentityCenterUser).where(
            IdentityCenterUser.account_id == account_id,
            IdentityCenterUser.active.is_(True),
        )
    ).all()
    out: list[FindingDraft] = []
    for user in rows:
        if user.external_created_at is None:
            continue
        if user.external_created_at >= cutoff:
            continue
        last_touch = user.external_updated_at or user.external_created_at
        if last_touch >= cutoff:
            continue
        days = (datetime.now(timezone.utc) - last_touch).days
        label = user.display_name or user.user_name or user.email or user.user_id
        out.append(
            FindingDraft(
                check_id=CHECK_ID,
                resource_arn=f"identity-center://{user.identity_store_id}/{user.user_id}",
                title=f"Identity Center user `{label}` has not been updated in {days or '90+'} days",
                severity="medium",
                risk_score=score("medium", age_days=days or THRESHOLD_DAYS),
                evidence={
                    "user_id": user.user_id,
                    "user_name": user.user_name,
                    "display_name": user.display_name,
                    "email": user.email,
                    "identity_store_id": user.identity_store_id,
                    "external_created_at": user.external_created_at.isoformat(),
                    "external_updated_at": user.external_updated_at.isoformat()
                    if user.external_updated_at
                    else None,
                    "days_since_update": days,
                    "threshold_days": THRESHOLD_DAYS,
                    "note": (
                        "Identity Store does not expose last sign-in via API. "
                        "Veritrail flags long-provisioned users with no directory update in 90+ days for access review."
                    ),
                },
            )
        )
    return out
