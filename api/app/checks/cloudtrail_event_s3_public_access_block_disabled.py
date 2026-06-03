"""Check 11: S3 Public Access Block Disabled — detect DeleteBucketPublicAccessBlock, PutBucketPublicAccessBlock."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models import AwsAccount
from app.models.cloudtrail import CloudTrailEvent

CHECK_ID = "cloudtrail.event.s3_public_access_block_disabled"

_PAB_EVENTS = frozenset({"DeleteBucketPublicAccessBlock", "PutBucketPublicAccessBlock"})


def _is_pab_disabling(params: dict) -> bool:
    """Check whether PutBucketPublicAccessBlock is disabling blocks.

    Returns True if any access block was set from true → false.
    Returns False if blocks are being enabled (false → true).
    """
    config = params.get("PublicAccessBlockConfiguration") or params.get("publicAccessBlockConfiguration") or {}
    if not config:
        return True  # unknown — surface it
    for key in ("BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets"):
        if config.get(key) is False:
            return True
        if isinstance(config.get(key), str) and config[key].lower() in ("false", "0"):
            return True
    return False


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
            CloudTrailEvent.event_name.in_(_PAB_EVENTS),
        )
        .order_by(CloudTrailEvent.event_time.desc())
    ).all()

    findings: list[FindingDraft] = []
    for event in events:
        # For PutBucketPublicAccessBlock, filter out enabling operations
        if event.event_name == "PutBucketPublicAccessBlock":
            params = (event.raw or {}).get("requestParameters") or {}
            if not _is_pab_disabling(params):
                continue

        bucket_name = ""
        for r in (event.resources or []):
            rname = r.get("name") or ""
            if "s3" in (r.get("type") or "").lower() or rname.startswith("arn:aws:s3:::"):
                bucket_name = rname.split("/")[-1].replace("arn:aws:s3:::", "")
                break

        title = (
            f"Public access block deleted for S3 bucket `{bucket_name or 'unknown'}` by {event.actor}"
            if event.event_name == "DeleteBucketPublicAccessBlock"
            else f"Public access block settings reduced for S3 bucket `{bucket_name or 'unknown'}` by {event.actor}"
        )

        findings.append(FindingDraft(
            check_id=CHECK_ID,
            resource_arn=f"arn:aws:s3:::{bucket_name}" if bucket_name else f"arn:aws:s3:::{acc.account_id or 'unknown'}:*",
            title=title,
            severity="critical",
            risk_score=score("critical"),
            evidence={
                "event_name": event.event_name,
                "event_time": event.event_time.isoformat(),
                "actor": event.actor,
                "source_ip": event.source_ip,
                "bucket_name": bucket_name,
            },
        ))

    return findings
