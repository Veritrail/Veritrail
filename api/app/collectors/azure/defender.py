"""Collect Microsoft Defender for Cloud plans, secure score, and finding depth."""
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
    plans: dict[str, dict] = {}
    for row in pricing:
        props = row.get("properties") or {}
        tier = props.get("pricingTier") or props.get("pricingTier")
        name = str(row.get("name") or "unknown")
        extensions = props.get("extensions") or []
        enabled = bool(tier and str(tier).lower() != "free")
        if tier:
            pricing_tier = tier
        if enabled:
            defender_enabled = True
        plans[name] = {
            "pricing_tier": tier,
            "enabled": enabled,
            "extensions": [
                {
                    "name": ext.get("name"),
                    "isEnabled": ext.get("isEnabled"),
                }
                for ext in extensions
                if isinstance(ext, dict)
            ][:20],
        }

    # Soft-collect assessments / sub-assessments for vuln-like recommendations.
    findings = {"critical": 0, "high": 0, "medium": 0, "low": 0, "assessment_count": 0}
    limitations: list[str] = []
    try:
        assessments, a_status = client._request_soft(
            "GET",
            f"/subscriptions/{subscription.subscription_id}/providers/Microsoft.Security/"
            f"assessments?api-version=2021-06-01&$top=100",
        )
    except Exception:  # noqa: BLE001
        assessments, a_status = {}, 500
        limitations.append("assessments_collect_failed")
    if a_status and a_status >= 400:
        limitations.append(f"assessments_api_status_{a_status}")
    else:
        for item in (assessments or {}).get("value") or []:
            findings["assessment_count"] += 1
            props = item.get("properties") or {}
            status_obj = props.get("status") or {}
            code = str(status_obj.get("code") or "").lower()
            severity = str(
                (props.get("metadata") or {}).get("severity")
                or status_obj.get("severity")
                or ""
            ).lower()
            if code in {"unhealthy", "nothealthy"}:
                if severity in findings:
                    findings[severity] += 1
                else:
                    findings["medium"] += 1

    evidence = {
        "plans": plans,
        "limitations": limitations,
        **findings,
    }

    stmt = pg_insert(AzureDefenderStatus).values(
        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{subscription.id}:defender"),
        azure_subscription_id=subscription.id,
        secure_score=secure_score,
        pricing_tier=pricing_tier,
        defender_enabled=defender_enabled,
        evidence_json=evidence,
        last_seen=_now(),
    ).on_conflict_do_update(
        index_elements=["azure_subscription_id"],
        set_={
            "secure_score": secure_score,
            "pricing_tier": pricing_tier,
            "defender_enabled": defender_enabled,
            "evidence_json": evidence,
            "last_seen": _now(),
        },
    )
    db.execute(stmt)
    log.info(
        "collect_azure_defender.done",
        subscription_id=subscription.subscription_id,
        defender_enabled=defender_enabled,
        plans=list(plans.keys()),
    )
    return 1
