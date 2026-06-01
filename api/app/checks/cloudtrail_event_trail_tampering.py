"""Check 2: CloudTrail Trail Tampering — detects StopLogging, DeleteTrail, UpdateTrail."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models import AwsAccount
from app.models.cloudtrail import CloudTrailEvent

CHECK_ID = "cloudtrail.event.trail_tampering"

_TRAIL_MUTATION_EVENTS = frozenset({"StopLogging", "DeleteTrail", "UpdateTrail"})

# UpdateTrail requestParameters keys that are benign — changing these isn't tampering.
_BENIGN_UPDATE_KEYS = frozenset({
    "name", "includeGlobalServiceEvents", "isMultiRegionTrail",
    "enableLogFileValidation", "cloudWatchLogsLogGroupArn",
    "cloudWatchLogsRoleArn", "kmsKeyId", "kmsKeyArn",
    "s3BucketName", "s3KeyPrefix", "snsTopicName",
    "snsTopicArn", "tags",
})


def _is_suspicious_update_trail(raw: dict) -> bool:
    """Check whether an UpdateTrail event is genuinely suspicious.

    Benign updates (enabling log validation, adding KMS, adding CloudWatch)
    are normal security hardening. Suspicious updates are those that disable
    logging features or remove protections.
    """
    params = raw.get("requestParameters") or {}
    if not params:
        return True  # unknown — surface it
    # If logging was explicitly disabled
    if params.get("enableLogFileValidation") is False:
        return True
    # If the trail was changed to single-region from multi-region
    if params.get("isMultiRegionTrail") is False:
        return True
    if params.get("includeGlobalServiceEvents") is False:
        return True
    # If they explicitly removed KMS encryption
    if "" in (params.get("kmsKeyId", ""),) and "kmsKeyId" in params:
        return True
    # If there are keys we don't recognize as benign
    unknown_keys = set(params.keys()) - _BENIGN_UPDATE_KEYS
    if unknown_keys:
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
            CloudTrailEvent.event_name.in_(_TRAIL_MUTATION_EVENTS),
        )
        .order_by(CloudTrailEvent.event_time.desc())
    ).all()

    findings: list[FindingDraft] = []
    for event in events:
        # For UpdateTrail, filter out benign security-hardening updates
        if event.event_name == "UpdateTrail":
            if not _is_suspicious_update_trail(event.raw or {}):
                continue

        trail_arn = ""
        for r in (event.resources or []):
            if (r.get("type") or "").lower() == "aws::cloudtrail::trail":
                trail_arn = r.get("name") or ""
                break

        findings.append(FindingDraft(
            check_id=CHECK_ID,
            resource_arn=trail_arn or f"arn:aws:cloudtrail:*:{acc.account_id or 'unknown'}:trail",
            title=f"CloudTrail trail was affected by {event.event_name} — review change",
            severity="critical",
            risk_score=score("critical"),
            evidence={
                "event_name": event.event_name,
                "event_time": event.event_time.isoformat(),
                "actor": event.actor,
                "source_ip": event.source_ip,
                "trail_arn": trail_arn,
            },
        ))

    return findings
