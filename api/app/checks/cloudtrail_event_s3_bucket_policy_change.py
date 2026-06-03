"""Check 4: S3 Bucket Policy or ACL Modified — detect PutBucketPolicy, DeleteBucketPolicy, PutBucketAcl."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models import AwsAccount
from app.models.cloudtrail import CloudTrailEvent

CHECK_ID = "cloudtrail.event.s3_bucket_policy_change"

_S3_POLICY_EVENTS = frozenset({"PutBucketPolicy", "DeleteBucketPolicy", "PutBucketAcl"})


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
            CloudTrailEvent.event_name.in_(_S3_POLICY_EVENTS),
        )
        .order_by(CloudTrailEvent.event_time.desc())
    ).all()

    findings: list[FindingDraft] = []
    for event in events:
        bucket_name = ""
        for r in (event.resources or []):
            rtype = (r.get("type") or "").lower()
            rname = r.get("name") or ""
            if "s3" in rtype and "bucket" in rtype:
                bucket_name = rname.split("/")[-1]
                break
            if rname.startswith("arn:aws:s3:::"):
                bucket_name = rname.replace("arn:aws:s3:::", "")

        resource_arn = (
            f"arn:aws:s3:::{bucket_name}"
            if bucket_name
            else f"arn:aws:s3:::{acc.account_id or 'unknown'}:*"
        )

        findings.append(FindingDraft(
            check_id=CHECK_ID,
            resource_arn=resource_arn,
            title=f"S3 bucket `{bucket_name or 'unknown'}` had {event.event_name} called by {event.actor}",
            severity="high",
            risk_score=score("high"),
            evidence={
                "event_name": event.event_name,
                "event_time": event.event_time.isoformat(),
                "actor": event.actor,
                "source_ip": event.source_ip,
                "bucket_name": bucket_name,
            },
        ))

    return findings
