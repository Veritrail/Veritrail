"""Check 15: Unusual API Call Volume — detect anomalous spike in CloudTrail event rate."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models import AwsAccount
from app.models.cloudtrail import CloudTrailEvent

CHECK_ID = "cloudtrail.event.anomalous_api_volume"

# Minimum thresholds to avoid false positives on new/quiet accounts
_MIN_EVENTS_FOR_ANOMALY = 50
_SPIKE_RATIO_THRESHOLD = 3.0


def run(db: Session, account_id) -> list[FindingDraft]:
    acc = db.get(AwsAccount, account_id)
    if not acc:
        return []

    lookback_24h = datetime.now(timezone.utc) - timedelta(hours=24)
    lookback_90d = datetime.now(timezone.utc) - timedelta(days=90)

    # Recent 24h event count
    recent_count = db.scalar(
        select(func.count(CloudTrailEvent.id)).where(
            CloudTrailEvent.account_id == account_id,
            CloudTrailEvent.event_time >= lookback_24h,
        )
    ) or 0

    # Total events over 90 days
    total_count = db.scalar(
        select(func.count(CloudTrailEvent.id)).where(
            CloudTrailEvent.account_id == account_id,
            CloudTrailEvent.event_time >= lookback_90d,
        )
    ) or 0

    # Not enough data to establish a baseline
    if total_count < _MIN_EVENTS_FOR_ANOMALY:
        return []

    daily_avg = total_count / 90.0
    if daily_avg <= 0:
        return []

    ratio = recent_count / daily_avg

    if ratio < _SPIKE_RATIO_THRESHOLD:
        return []

    # Get top event names in the spike for context
    top_events = db.execute(
        select(CloudTrailEvent.event_name, func.count(CloudTrailEvent.id).label("cnt"))
        .where(
            CloudTrailEvent.account_id == account_id,
            CloudTrailEvent.event_time >= lookback_24h,
        )
        .group_by(CloudTrailEvent.event_name)
        .order_by(func.count(CloudTrailEvent.id).desc())
        .limit(5)
    ).all()

    top_event_names = [{"event_name": row.event_name, "count": row.cnt} for row in top_events]

    return [FindingDraft(
        check_id=CHECK_ID,
        resource_arn=f"arn:aws:iam::{acc.account_id or 'unknown'}:account",
        title=f"Unusual API call volume: {recent_count} events in 24h vs {daily_avg:.0f}/day average ({ratio:.1f}x spike)",
        severity="medium",
        risk_score=score("medium"),
        evidence={
            "recent_24h_count": recent_count,
            "daily_average_90d": round(daily_avg, 1),
            "spike_ratio": round(ratio, 1),
            "total_events_90d": total_count,
            "top_events_in_spike": top_event_names,
        },
    )]
