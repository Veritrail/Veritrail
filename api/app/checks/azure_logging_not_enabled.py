from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.azure_subscription import AzureActivityLogSettings, AzureSubscription

CHECK_ID = "azure.logging.not_enabled"


def run(db: Session, azure_subscription_id) -> list[FindingDraft]:
    subscription = db.get(AzureSubscription, azure_subscription_id)
    if not subscription:
        return []

    row = db.scalar(
        select(AzureActivityLogSettings).where(
            AzureActivityLogSettings.azure_subscription_id == azure_subscription_id
        )
    )
    if row and row.activity_log_export_enabled:
        return []

    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=f"azure://subscription/{subscription.subscription_id}/logging",
            title="Azure Activity Log export is not configured",
            severity="medium",
            risk_score=score("medium"),
            evidence={
                "subscription_id": subscription.subscription_id,
                "diagnostic_settings_count": row.diagnostic_settings_count if row else 0,
                "expectation": (
                    "At least one subscription diagnostic setting exports Activity Log "
                    "categories to Log Analytics, storage, or Event Hub."
                ),
            },
        )
    ]
