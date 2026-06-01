"""Check 3: IAM User Policy Attachment — detect AttachUserPolicy, PutUserPolicy, AddUserToGroup."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models import AwsAccount
from app.models.cloudtrail import CloudTrailEvent

CHECK_ID = "cloudtrail.event.iam_user_policy_attachment"

_USER_POLICY_EVENTS = frozenset({"AttachUserPolicy", "PutUserPolicy", "AddUserToGroup"})


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
            CloudTrailEvent.event_name.in_(_USER_POLICY_EVENTS),
        )
        .order_by(CloudTrailEvent.event_time.desc())
    ).all()

    findings: list[FindingDraft] = []
    for event in events:
        raw = event.raw or {}
        params = raw.get("requestParameters") or {}
        policy_arn = params.get("policyArn") or ""
        user_name = ""
        group_name = ""
        for r in (event.resources or []):
            rtype = (r.get("type") or "").lower()
            if rtype == "aws::iam::user":
                user_name = r.get("name") or ""
            elif rtype == "aws::iam::group":
                group_name = r.get("name") or ""

        if event.event_name == "AddUserToGroup":
            title = f"IAM user added to group `{group_name}` by {event.actor}"
            sev = "medium"
            evidence_detail = {
                "event_name": event.event_name,
                "event_time": event.event_time.isoformat(),
                "actor": event.actor,
                "group_name": group_name,
                "user_name": user_name,
            }
        else:
            title = f"IAM policy `{policy_arn}` {'attached to' if event.event_name == 'AttachUserPolicy' else 'put on'} user by {event.actor}"
            sev = "high"
            evidence_detail = {
                "event_name": event.event_name,
                "event_time": event.event_time.isoformat(),
                "actor": event.actor,
                "source_ip": event.source_ip,
                "policy_arn": policy_arn,
                "user_name": user_name,
            }

        findings.append(FindingDraft(
            check_id=CHECK_ID,
            resource_arn=user_name or f"arn:aws:iam::{acc.account_id or 'unknown'}:user",
            title=title,
            severity=sev,
            risk_score=score(sev),
            evidence=evidence_detail,
        ))

    return findings
