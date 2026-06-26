from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.azure_subscription import AzureDefenderStatus, AzureSubscription

CHECK_ID = "azure.defender.not_enabled"


def run(db: Session, azure_subscription_id) -> list[FindingDraft]:
    subscription = db.get(AzureSubscription, azure_subscription_id)
    if not subscription:
        return []

    row = db.scalar(
        select(AzureDefenderStatus).where(
            AzureDefenderStatus.azure_subscription_id == azure_subscription_id
        )
    )
    if row and row.defender_enabled:
        return []

    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=f"azure://subscription/{subscription.subscription_id}/defender",
            title="Microsoft Defender for Cloud is not enabled",
            severity="medium",
            risk_score=score("medium"),
            evidence={
                "subscription_id": subscription.subscription_id,
                "pricing_tier": row.pricing_tier if row else None,
                "secure_score": row.secure_score if row else None,
            },
        )
    ]
