from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.azure_subscription import AzurePrivilegedRoleAssignment, AzureSubscription

CHECK_ID = "azure.entra.privileged_role_assignment"


def run(db: Session, azure_subscription_id) -> list[FindingDraft]:
    subscription = db.get(AzureSubscription, azure_subscription_id)
    if not subscription:
        return []

    rows = db.scalars(
        select(AzurePrivilegedRoleAssignment).where(
            AzurePrivilegedRoleAssignment.azure_subscription_id == azure_subscription_id
        )
    ).all()

    drafts: list[FindingDraft] = []
    for row in rows:
        drafts.append(
            FindingDraft(
                check_id=CHECK_ID,
                resource_arn=f"azure://rbac/{subscription.subscription_id}/{row.assignment_id}",
                title=(
                    f"Azure privileged role `{row.role_name}` assigned to "
                    f"{row.principal_type or 'principal'} {row.principal_id}"
                ),
                severity="high",
                risk_score=score("high", admin=True),
                evidence={
                    "subscription_id": subscription.subscription_id,
                    "assignment_id": row.assignment_id,
                    "role_name": row.role_name,
                    "role_definition_id": row.role_definition_id,
                    "principal_id": row.principal_id,
                    "principal_type": row.principal_type,
                    "scope": row.scope,
                    "expectation": (
                        "Review privileged Azure RBAC assignments (Owner, User Access Administrator, "
                        "Contributor, RBAC Administrator) and remove or justify each assignment."
                    ),
                },
            )
        )
    return drafts
