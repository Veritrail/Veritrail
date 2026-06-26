"""Collect Microsoft Defender secure score and pricing tier."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.azure_subscription import AzureDefenderStatus, AzureSubscription
from app.services.azure_client import AzureClient

log = structlog.get_logger()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def collect_defender(db: Session, subscription: AzureSubscription) -> int:
    client = AzureClient(
        tenant_id=subscription.tenant_id,
        client_id=subscription.client_id,
        client_secret=subscription.client_secret,
    )
    scores = client.list_secure_scores(subscription.subscription_id)
    pricing = client.get_security_pricing(subscription.subscription_id)

    secure_score = None
    if scores:
        props = scores[0].get("properties") or {}
        secure_score = props.get("score", {}).get("current")

    pricing_tier = None
    defender_enabled = False
    for row in pricing:
        props = row.get("properties") or {}
        tier = props.get("pricingTier")
        if tier:
            pricing_tier = tier
        if tier and tier.lower() != "free":
            defender_enabled = True

    stmt = pg_insert(AzureDefenderStatus).values(
        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{subscription.id}:defender"),
        azure_subscription_id=subscription.id,
        secure_score=secure_score,
        pricing_tier=pricing_tier,
        defender_enabled=defender_enabled,
        last_seen=_now(),
    ).on_conflict_do_update(
        index_elements=["azure_subscription_id"],
        set_={
            "secure_score": secure_score,
            "pricing_tier": pricing_tier,
            "defender_enabled": defender_enabled,
            "last_seen": _now(),
        },
    )
    db.execute(stmt)
    log.info(
        "collect_azure_defender.done",
        subscription_id=subscription.subscription_id,
        defender_enabled=defender_enabled,
    )
    return 1
