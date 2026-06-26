from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.azure_subscription import AzureStorageAccount, AzureSubscription

CHECK_ID = "azure.storage.public_blob_access"


def run(db: Session, azure_subscription_id) -> list[FindingDraft]:
    subscription = db.get(AzureSubscription, azure_subscription_id)
    if not subscription:
        return []

    public_accounts = db.scalars(
        select(AzureStorageAccount).where(
            AzureStorageAccount.azure_subscription_id == azure_subscription_id,
            AzureStorageAccount.public_blob_access == True,  # noqa: E712
        )
    ).all()

    drafts: list[FindingDraft] = []
    for acct in public_accounts:
        drafts.append(
            FindingDraft(
                check_id=CHECK_ID,
                resource_arn=f"azure://storage/{subscription.subscription_id}/{acct.account_name}",
                title=f"Azure storage account {acct.account_name} allows public blob access",
                severity="high",
                risk_score=score("high"),
                evidence={
                    "subscription_id": subscription.subscription_id,
                    "account_name": acct.account_name,
                    "resource_group": acct.resource_group,
                },
            )
        )
    return drafts
