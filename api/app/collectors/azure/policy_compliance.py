"""Collect Azure Policy non-compliant resource states at subscription scope."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.azure_subscription import (
    AzurePolicyCompliance,
    AzurePolicyNonCompliance,
    AzureSubscription,
)
from app.services.azure_client import AzureClient

log = structlog.get_logger()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _policy_state_id(row: dict) -> str:
    explicit = str(row.get("id") or "")
    if explicit:
        return explicit
    props = row.get("properties") or {}
    resource_id = str(props.get("resourceId") or "")
    assignment_id = str(props.get("policyAssignmentId") or "")
    definition_id = str(props.get("policyDefinitionId") or "")
    return f"{resource_id}:{assignment_id}:{definition_id}"


def collect_policy_compliance(db: Session, subscription: AzureSubscription) -> int:
    client = AzureClient(
        tenant_id=subscription.tenant_id,
        client_id=subscription.client_id,
        client_secret=subscription.client_secret,
    )
    states, status = client.list_policy_states(
        subscription.subscription_id,
        compliance_filter="NonCompliant",
    )
    if status and status >= 400:
        log.info(
            "collect_azure_policy_compliance.skipped",
            subscription_id=subscription.subscription_id,
            status=status,
        )
        return 0

    policy_insights_enabled = status is not None and status < 400
    count = 0
    for row in states:
        state_id = _policy_state_id(row)
        if not state_id:
            continue
        props = row.get("properties") or {}
        stmt = pg_insert(AzurePolicyNonCompliance).values(
            id=uuid.uuid5(uuid.NAMESPACE_URL, f"{subscription.id}:policy:{state_id}"),
            azure_subscription_id=subscription.id,
            policy_state_id=state_id,
            policy_definition_name=str(props.get("policyDefinitionName") or ""),
            policy_assignment_name=str(props.get("policyAssignmentName") or ""),
            resource_id=str(props.get("resourceId") or ""),
            resource_type=str(props.get("resourceType") or ""),
            compliance_state=str(props.get("complianceState") or "NonCompliant"),
            last_seen=_now(),
        ).on_conflict_do_update(
            index_elements=["azure_subscription_id", "policy_state_id"],
            set_={
                "policy_definition_name": str(props.get("policyDefinitionName") or ""),
                "policy_assignment_name": str(props.get("policyAssignmentName") or ""),
                "resource_id": str(props.get("resourceId") or ""),
                "resource_type": str(props.get("resourceType") or ""),
                "compliance_state": str(props.get("complianceState") or "NonCompliant"),
                "last_seen": _now(),
            },
        )
        db.execute(stmt)
        count += 1

    summary_stmt = pg_insert(AzurePolicyCompliance).values(
        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{subscription.id}:policy_compliance"),
        azure_subscription_id=subscription.id,
        policy_insights_enabled=policy_insights_enabled,
        non_compliant_count=count,
        last_seen=_now(),
    ).on_conflict_do_update(
        index_elements=["azure_subscription_id"],
        set_={
            "policy_insights_enabled": policy_insights_enabled,
            "non_compliant_count": count,
            "last_seen": _now(),
        },
    )
    db.execute(summary_stmt)
    log.info(
        "collect_azure_policy_compliance.done",
        subscription_id=subscription.subscription_id,
        non_compliant_count=count,
    )
    return count
