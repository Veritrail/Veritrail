from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.core.aws import assume_role
from app.models import AwsAccount

CHECK_ID = "iam.root.usage"


def run(db: Session, account_id) -> list[FindingDraft]:
    acc = db.get(AwsAccount, account_id)
    if not acc:
        return []

    try:
        sess = assume_role(acc.role_arn, acc.external_id, session_name="veritrail-root-usage", aws_account=acc, purpose="check_iam_root_usage")
        ct = sess.client("cloudtrail", region_name="us-east-1")
        now = datetime.now(timezone.utc)
        resp = ct.lookup_events(
            LookupAttributes=[{"AttributeKey": "Username", "AttributeValue": "root"}],
            StartTime=now - timedelta(days=90),
            EndTime=now,
            MaxResults=1,
        )
    except Exception:  # noqa: BLE001
        return []

    events = resp.get("Events", [])
    if not events:
        return []

    last_event = events[0]
    last_used = last_event.get("EventTime")
    event_name = last_event.get("EventName", "unknown")
    days_ago = int((now - last_used).total_seconds() / 86400) if last_used else None

    return [FindingDraft(
        check_id=CHECK_ID,
        resource_arn=f"arn:aws:iam::{acc.account_id or 'unknown'}:root",
        title="Root account was used recently",
        severity="high",
        risk_score=score("high"),
        evidence={
            "last_event": event_name,
            "last_used_at": last_used.isoformat() if last_used else None,
            "days_ago": days_ago,
        },
    )]
