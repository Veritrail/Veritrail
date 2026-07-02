from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.azure_subscription import AzureComputeInstance, AzureSubscription

CHECK_ID = "azure.compute.instance_public_ip"


def run(db: Session, azure_subscription_id) -> list[FindingDraft]:
    subscription = db.get(AzureSubscription, azure_subscription_id)
    if not subscription:
        return []

    exposed = db.scalars(
        select(AzureComputeInstance).where(
            AzureComputeInstance.azure_subscription_id == azure_subscription_id,
            AzureComputeInstance.has_public_ip == True,  # noqa: E712
        )
    ).all()

    drafts: list[FindingDraft] = []
    for vm in exposed:
        drafts.append(
            FindingDraft(
                check_id=CHECK_ID,
                resource_arn=f"azure://compute/{subscription.subscription_id}/{vm.name}",
                title=f"Azure compute instance {vm.name} has a public IP",
                severity="high",
                risk_score=score("high"),
                evidence={
                    "subscription_id": subscription.subscription_id,
                    "vm_id": vm.vm_id,
                    "name": vm.name,
                    "resource_group": vm.resource_group,
                    "location": vm.location,
                },
            )
        )
    return drafts
