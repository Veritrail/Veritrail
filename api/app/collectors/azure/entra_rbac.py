"""Collect Azure RBAC privileged role assignments at subscription scope."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.azure_subscription import AzurePrivilegedRoleAssignment, AzureSubscription
from app.services.azure_client import AzureClient, privileged_role_name

log = structlog.get_logger()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def collect_entra_rbac(db: Session, subscription: AzureSubscription) -> int:
    client = AzureClient(
        tenant_id=subscription.tenant_id,
        client_id=subscription.client_id,
        client_secret=subscription.client_secret,
    )
    assignments, status = client.list_role_assignments(subscription.subscription_id)
    if status and status >= 400:
        log.info(
            "collect_azure_entra_rbac.skipped",
            subscription_id=subscription.subscription_id,
            status=status,
        )
        return 0

    count = 0
    for row in assignments:
        props = row.get("properties") or {}
        role_definition_id = str(props.get("roleDefinitionId") or "")
        role_name = privileged_role_name(role_definition_id)
        if not role_name:
            continue
        assignment_id = str(row.get("name") or row.get("id") or "")
        if not assignment_id:
            continue
        principal_id = str(props.get("principalId") or "")
        principal_type = str(props.get("principalType") or "")
        scope = str(props.get("scope") or "")
        stmt = pg_insert(AzurePrivilegedRoleAssignment).values(
            id=uuid.uuid5(uuid.NAMESPACE_URL, f"{subscription.id}:rbac:{assignment_id}"),
            azure_subscription_id=subscription.id,
            assignment_id=assignment_id,
            role_name=role_name,
            role_definition_id=role_definition_id,
            principal_id=principal_id,
            principal_type=principal_type,
            scope=scope,
            last_seen=_now(),
        ).on_conflict_do_update(
            index_elements=["azure_subscription_id", "assignment_id"],
            set_={
                "role_name": role_name,
                "role_definition_id": role_definition_id,
                "principal_id": principal_id,
                "principal_type": principal_type,
                "scope": scope,
                "last_seen": _now(),
            },
        )
        db.execute(stmt)
        count += 1

    log.info(
        "collect_azure_entra_rbac.done",
        subscription_id=subscription.subscription_id,
        privileged_assignments=count,
    )
    return count
