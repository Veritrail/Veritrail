"""Check 5: IAM Role/Policy Mutation — detect CreateRole, DeleteRole, CreatePolicy, DeletePolicy, PutRolePolicy, DeleteRolePolicy, UpdateAssumeRolePolicy."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models import AwsAccount
from app.models.cloudtrail import CloudTrailEvent

CHECK_ID = "cloudtrail.event.iam_role_policy_mutation"

_IAM_MUTATION_EVENTS = frozenset({
    "CreateRole", "DeleteRole", "CreatePolicy", "DeletePolicy",
    "PutRolePolicy", "DeleteRolePolicy", "UpdateAssumeRolePolicy",
})

# Service-linked role actors that should not trigger findings
_SERVICE_LINKED_PREFIXES = (
    "AWSServiceRoleFor", "AWSServiceRole-",
)


def _is_service_linked_role(actor: str | None) -> bool:
    if not actor:
        return False
    return any(
        actor.startswith(prefix) or f"/{prefix}" in actor
        for prefix in _SERVICE_LINKED_PREFIXES
    )


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
            CloudTrailEvent.event_name.in_(_IAM_MUTATION_EVENTS),
        )
        .order_by(CloudTrailEvent.event_time.desc())
    ).all()

    findings: list[FindingDraft] = []
    for event in events:
        if _is_service_linked_role(event.actor):
            continue

        raw = event.raw or {}
        params = raw.get("requestParameters") or {}
        policy_name = params.get("policyName") or params.get("policyDocument") or ""
        role_name = params.get("roleName") or ""

        resource_arn = ""
        for r in (event.resources or []):
            rname = r.get("name") or ""
            if "::role/" in rname or "::policy/" in rname or "::role-" in rname:
                resource_arn = rname
                break

        findings.append(FindingDraft(
            check_id=CHECK_ID,
            resource_arn=resource_arn or f"arn:aws:iam::{acc.account_id or 'unknown'}:*",
            title=f"IAM {event.event_name} executed by {event.actor}",
            severity="high",
            risk_score=score("high"),
            evidence={
                "event_name": event.event_name,
                "event_time": event.event_time.isoformat(),
                "actor": event.actor,
                "source_ip": event.source_ip,
                "policy_name": policy_name if isinstance(policy_name, str) else "",
                "role_name": role_name,
                "resource_arn": resource_arn,
            },
        ))

    return findings
