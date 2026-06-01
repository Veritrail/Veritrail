"""Check 1: Root API Activity — detect root user API calls (break-glass only)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models import AwsAccount
from app.models.cloudtrail import CloudTrailEvent

CHECK_ID = "cloudtrail.event.root_activity"

_ROOT_EXCLUDE_EVENTS = frozenset({"CheckMfa", "GetAccountSummary"})


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
            CloudTrailEvent.actor.ilike("%root%"),
            CloudTrailEvent.event_name.notin_(_ROOT_EXCLUDE_EVENTS),
        )
        .order_by(CloudTrailEvent.event_time.desc())
        .limit(1)
    ).scalar_one_or_none()

    if not event:
        return []

    return [FindingDraft(
        check_id=CHECK_ID,
        resource_arn=f"arn:aws:iam::{acc.account_id or 'unknown'}:root",
        title=f"Root user called {event.event_name} — review immediately",
        severity="critical",
        risk_score=score("critical"),
        evidence={
            "event_name": event.event_name,
            "event_time": event.event_time.isoformat(),
            "actor": event.actor,
            "source_ip": event.source_ip,
            "event_source": event.event_source,
        },
    )]
