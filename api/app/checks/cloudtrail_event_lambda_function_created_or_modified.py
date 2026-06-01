"""Check 12: Lambda Function Created or Modified — detect CreateFunction, UpdateFunctionConfiguration."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models import AwsAccount
from app.models.cloudtrail import CloudTrailEvent

CHECK_ID = "cloudtrail.event.lambda_function_created_or_modified"

_LAMBDA_MUTATION_EVENTS = frozenset({"CreateFunction", "UpdateFunctionConfiguration"})


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
            CloudTrailEvent.event_name.in_(_LAMBDA_MUTATION_EVENTS),
        )
        .order_by(CloudTrailEvent.event_time.desc())
    ).all()

    findings: list[FindingDraft] = []
    for event in events:
        raw = event.raw or {}
        params = raw.get("requestParameters") or {}
        function_name = params.get("functionName") or ""

        resource_arn = ""
        for r in (event.resources or []):
            rname = r.get("name") or ""
            if "lambda" in (r.get("type") or "").lower() or ":function:" in rname:
                resource_arn = rname
                if not function_name:
                    function_name = rname.split(":function:")[-1]
                break

        action_verb = "created" if event.event_name == "CreateFunction" else "modified"

        findings.append(FindingDraft(
            check_id=CHECK_ID,
            resource_arn=resource_arn or f"arn:aws:lambda:*:{acc.account_id or 'unknown'}:function",
            title=f"Lambda function `{function_name or 'unknown'}` {action_verb} by {event.actor}",
            severity="medium",
            risk_score=score("medium"),
            evidence={
                "event_name": event.event_name,
                "event_time": event.event_time.isoformat(),
                "actor": event.actor,
                "source_ip": event.source_ip,
                "function_name": function_name,
                "resource_arn": resource_arn,
            },
        ))

    return findings
