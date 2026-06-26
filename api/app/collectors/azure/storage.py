"""Collect Azure storage accounts public blob access flag."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.azure_subscription import AzureStorageAccount, AzureSubscription
from app.services.azure_client import AzureClient

log = structlog.get_logger()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def collect_storage_accounts(db: Session, subscription: AzureSubscription) -> int:
    client = AzureClient(
        tenant_id=subscription.tenant_id,
        client_id=subscription.client_id,
        client_secret=subscription.client_secret,
    )
    accounts = client.list_storage_accounts(subscription.subscription_id)
    count = 0
    for row in accounts:
        name = row.get("name") or ""
        if not name:
            continue
        props = row.get("properties") or {}
        public_blob = bool(props.get("allowBlobPublicAccess"))
        resource_group = ""
        rid = row.get("id") or ""
        if "/resourceGroups/" in rid:
            resource_group = rid.split("/resourceGroups/", 1)[1].split("/", 1)[0]
        stmt = pg_insert(AzureStorageAccount).values(
            id=uuid.uuid5(uuid.NAMESPACE_URL, f"{subscription.id}:storage:{name}"),
            azure_subscription_id=subscription.id,
            account_name=name,
            resource_group=resource_group,
            public_blob_access=public_blob,
            last_seen=_now(),
        ).on_conflict_do_update(
            index_elements=["azure_subscription_id", "account_name"],
            set_={
                "resource_group": resource_group,
                "public_blob_access": public_blob,
                "last_seen": _now(),
            },
        )
        db.execute(stmt)
        count += 1
    log.info("collect_azure_storage.done", subscription_id=subscription.subscription_id, accounts=count)
    return count
