from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.azure_subscription import (
    AzurePolicyCompliance,
    AzurePolicyNonCompliance,
    AzureSubscription,
)

CHECK_ID = "azure.policy.non_compliant"


def run(db: Session, azure_subscription_id) -> list[FindingDraft]:
    subscription = db.get(AzureSubscription, azure_subscription_id)
    if not subscription:
        return []

    summary = db.scalar(
        select(AzurePolicyCompliance).where(
            AzurePolicyCompliance.azure_subscription_id == azure_subscription_id
        )
    )
    if not summary or not summary.policy_insights_enabled or summary.non_compliant_count == 0:
        return []

    sample = db.scalars(
        select(AzurePolicyNonCompliance)
        .where(AzurePolicyNonCompliance.azure_subscription_id == azure_subscription_id)
        .limit(30)
    ).all()

    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=f"azure://subscription/{subscription.subscription_id}/policy",
            title=(
                f"Azure Policy reports {summary.non_compliant_count} non-compliant "
                "resource state(s)"
            ),
            severity="medium",
            risk_score=score("medium"),
            evidence={
                "subscription_id": subscription.subscription_id,
                "non_compliant_count": summary.non_compliant_count,
                "sample_violations": [
                    {
                        "policy_definition_name": row.policy_definition_name,
                        "policy_assignment_name": row.policy_assignment_name,
                        "resource_id": row.resource_id,
                        "resource_type": row.resource_type,
                        "compliance_state": row.compliance_state,
                    }
                    for row in sample
                ],
                "expectation": (
                    "Remediate or exempt non-compliant Azure Policy assignments and "
                    "re-evaluate subscription policy compliance."
                ),
            },
        )
    ]
