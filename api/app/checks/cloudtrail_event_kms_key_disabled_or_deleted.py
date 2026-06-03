"""Check 7: KMS Key Disabled or Scheduled for Deletion — detect DisableKey, ScheduleKeyDeletion."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models import AwsAccount
from app.models.cloudtrail import CloudTrailEvent

CHECK_ID = "cloudtrail.event.kms_key_disabled_or_deleted"

_KMS_DESTROY_EVENTS = frozenset({"DisableKey", "ScheduleKeyDeletion"})


def run(db: Session, account_id) -> list[FindingDraft]:
    acc = db.get(AwsAccount, account_id)
    if not acc:
        return []

    lookback = datetime.now(timezone.utc) - timedelta(days=90)

    events = db.scalars(
        select(CloudTrailEvent)
        .where(
            CloudTrailEvent.account_id == account_id,
            CloudTrailEvent.event_time >= lookback,
            CloudTrailEvent.event_name.in_(_KMS_DESTROY_EVENTS),
        )
        .order_by(CloudTrailEvent.event_time.desc())
    ).all()

    findings: list[FindingDraft] = []
    for event in events:
        key_arn = ""
        for r in (event.resources or []):
            rname = r.get("name") or ""
            if "kms" in (r.get("type") or "").lower() or ":key/" in rname:
                key_arn = rname
                break

        title = (
            f"KMS key `{key_arn or 'unknown'}` was {event.event_name}"
            if event.event_name == "ScheduleKeyDeletion"
            else f"KMS key was {event.event_name} — data encrypted under it is inaccessible"
        )

        findings.append(FindingDraft(
            check_id=CHECK_ID,
            resource_arn=key_arn or f"arn:aws:kms:*:{acc.account_id or 'unknown'}:key",
            title=title,
            severity="critical",
            risk_score=score("critical"),
            evidence={
                "event_name": event.event_name,
                "event_time": event.event_time.isoformat(),
                "actor": event.actor,
                "source_ip": event.source_ip,
                "key_arn": key_arn,
            },
        ))

    return findings
