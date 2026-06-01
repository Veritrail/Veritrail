"""Check 10: IAM Access Key Created/Activated — detect CreateAccessKey, UpdateAccessKey."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models import AwsAccount
from app.models.cloudtrail import CloudTrailEvent

CHECK_ID = "cloudtrail.event.iam_access_key_created"

_ACCESS_KEY_EVENTS = frozenset({"CreateAccessKey", "UpdateAccessKey"})


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
            CloudTrailEvent.event_name.in_(_ACCESS_KEY_EVENTS),
        )
        .order_by(CloudTrailEvent.event_time.desc())
    ).all()

    findings: list[FindingDraft] = []
    for event in events:
        raw = event.raw or {}
        params = raw.get("requestParameters") or {}
        access_key_id = params.get("accessKeyId") or ""

        user_name = ""
        for r in (event.resources or []):
            rtype = (r.get("type") or "").lower()
            if "user" in rtype:
                user_name = r.get("name") or ""
                break

        action_verb = "created" if event.event_name == "CreateAccessKey" else "modified"

        findings.append(FindingDraft(
            check_id=CHECK_ID,
            resource_arn=user_name or f"arn:aws:iam::{acc.account_id or 'unknown'}:user",
            title=f"IAM access key {action_verb} for user `{user_name or 'unknown'}` by {event.actor}",
            severity="medium",
            risk_score=score("medium"),
            evidence={
                "event_name": event.event_name,
                "event_time": event.event_time.isoformat(),
                "actor": event.actor,
                "source_ip": event.source_ip,
                "user_name": user_name,
                "access_key_id": access_key_id,
            },
        ))

    return findings
