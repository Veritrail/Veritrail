"""Collect Azure subscription Activity Log / diagnostic settings evidence."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.azure_subscription import AzureActivityLogSettings, AzureSubscription
from app.services.azure_client import AzureClient

log = structlog.get_logger()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _activity_log_export_enabled(settings: list[dict]) -> bool:
    for setting in settings:
        props = setting.get("properties") or {}
        logs = props.get("logs") or []
        has_enabled_log = any(log.get("enabled") for log in logs)
        has_destination = bool(
            props.get("workspaceId")
            or props.get("storageAccountId")
            or props.get("eventHubAuthorizationRuleId")
        )
        if has_enabled_log and has_destination:
            return True
    return False


def collect_activity_log(db: Session, subscription: AzureSubscription) -> int:
    client = AzureClient(
        tenant_id=subscription.tenant_id,
        client_id=subscription.client_id,
        client_secret=subscription.client_secret,
    )
    settings, status = client.list_subscription_diagnostic_settings(subscription.subscription_id)
    if status and status >= 400:
        log.info(
            "collect_azure_activity_log.skipped",
            subscription_id=subscription.subscription_id,
            status=status,
        )
        return 0

    export_enabled = _activity_log_export_enabled(settings)
    stmt = pg_insert(AzureActivityLogSettings).values(
        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{subscription.id}:activity_log"),
        azure_subscription_id=subscription.id,
        activity_log_export_enabled=export_enabled,
        diagnostic_settings_count=len(settings),
        last_seen=_now(),
    ).on_conflict_do_update(
        index_elements=["azure_subscription_id"],
        set_={
            "activity_log_export_enabled": export_enabled,
            "diagnostic_settings_count": len(settings),
            "last_seen": _now(),
        },
    )
    db.execute(stmt)
    log.info(
        "collect_azure_activity_log.done",
        subscription_id=subscription.subscription_id,
        export_enabled=export_enabled,
        settings=len(settings),
    )
    return 1
