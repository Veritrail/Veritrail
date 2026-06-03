"""Check 8: GuardDuty Detector Deleted — detect DeleteDetector (attacker disabling threat detection)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models import AwsAccount
from app.models.cloudtrail import CloudTrailEvent

CHECK_ID = "cloudtrail.event.guardduty_disabled"


def run(db: Session, account_id) -> list[FindingDraft]:
    acc = db.get(AwsAccount, account_id)
    if not acc:
        return []

    lookback = datetime.now(timezone.utc) - timedelta(days=90)

    event = db.execute(
        select(CloudTrailEvent)
        .where(
            CloudTrailEvent.account_id == account_id,
            CloudTrailEvent.event_time >= lookback,
            CloudTrailEvent.event_name == "DeleteDetector",
        )
        .order_by(CloudTrailEvent.event_time.desc())
        .limit(1)
    ).scalar_one_or_none()

    if not event:
        return []

    detector_id = ""
    for r in (event.resources or []):
        rname = r.get("name") or ""
        if "detector" in (r.get("type") or "").lower() or "detector/" in rname:
            detector_id = rname.split("/")[-1]
            break

    return [FindingDraft(
        check_id=CHECK_ID,
        resource_arn=f"arn:aws:guardduty:*:{acc.account_id or 'unknown'}:detector",
        title=f"GuardDuty detector was deleted by {event.actor} — threat detection disabled",
        severity="high",
        risk_score=score("high"),
        evidence={
            "event_time": event.event_time.isoformat(),
            "actor": event.actor,
            "source_ip": event.source_ip,
            "detector_id": detector_id,
        },
    )]
