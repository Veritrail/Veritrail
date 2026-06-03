"""Check 13: EC2 Instance Terminated or Modified — detect TerminateInstances, ModifyInstanceAttribute."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models import AwsAccount
from app.models.cloudtrail import CloudTrailEvent

CHECK_ID = "cloudtrail.event.ec2_instance_tampering"

_EC2_TAMPER_EVENTS = frozenset({"TerminateInstances", "ModifyInstanceAttribute"})


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
            CloudTrailEvent.event_name.in_(_EC2_TAMPER_EVENTS),
        )
        .order_by(CloudTrailEvent.event_time.desc())
    ).all()

    findings: list[FindingDraft] = []
    for event in events:
        instance_ids: list[str] = []
        for r in (event.resources or []):
            rname = r.get("name") or ""
            if "instance" in (r.get("type") or "").lower() or rname.startswith("i-"):
                instance_ids.append(rname)

        instance_str = ", ".join(instance_ids[:5]) if instance_ids else "unknown"
        if len(instance_ids) > 5:
            instance_str += f" (+{len(instance_ids) - 5} more)"

        raw = event.raw or {}
        params = raw.get("requestParameters") or {}
        attribute = params.get("attribute") or params.get("Attribute") or ""

        title = (
            f"EC2 instance(s) `{instance_str}` terminated by {event.actor}"
            if event.event_name == "TerminateInstances"
            else f"EC2 instance `{instance_str}` attribute `{attribute}` modified by {event.actor}"
        )

        findings.append(FindingDraft(
            check_id=CHECK_ID,
            resource_arn=instance_ids[0] if instance_ids else f"arn:aws:ec2:*:{acc.account_id or 'unknown'}:instance",
            title=title,
            severity="high",
            risk_score=score("high"),
            evidence={
                "event_name": event.event_name,
                "event_time": event.event_time.isoformat(),
                "actor": event.actor,
                "source_ip": event.source_ip,
                "instance_ids": instance_ids,
                "attribute": attribute,
            },
        ))

    return findings
