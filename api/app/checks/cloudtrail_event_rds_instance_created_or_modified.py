"""Check 14: RDS Instance Created or Modified — detect CreateDBInstance, ModifyDBInstance."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models import AwsAccount
from app.models.cloudtrail import CloudTrailEvent

CHECK_ID = "cloudtrail.event.rds_instance_created_or_modified"

_RDS_MUTATION_EVENTS = frozenset({"CreateDBInstance", "ModifyDBInstance"})


def _check_suspicious_params(event_name: str, params: dict) -> list[str]:
    """For ModifyDBInstance, extract suspicious parameter changes."""
    if event_name == "CreateDBInstance":
        return []
    warnings: list[str] = []
    if params.get("publiclyAccessible") is True:
        warnings.append("publiclyAccessible set to true")
    if params.get("storageEncrypted") is False:
        warnings.append("storageEncrypted set to false")
    if params.get("deletionProtection") is False:
        warnings.append("deletionProtection set to false")
    if params.get("backupRetentionPeriod") == 0:
        warnings.append("backupRetentionPeriod set to 0")
    return warnings


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
            CloudTrailEvent.event_name.in_(_RDS_MUTATION_EVENTS),
        )
        .order_by(CloudTrailEvent.event_time.desc())
    ).all()

    findings: list[FindingDraft] = []
    for event in events:
        raw = event.raw or {}
        params = raw.get("requestParameters") or {}
        db_id = params.get("dBInstanceIdentifier") or params.get("DBInstanceIdentifier") or ""

        resource_arn = ""
        for r in (event.resources or []):
            rname = r.get("name") or ""
            if "rds" in (r.get("type") or "").lower() or ":db:" in rname:
                resource_arn = rname
                break

        suspicious = _check_suspicious_params(event.event_name, params)
        action_verb = "created" if event.event_name == "CreateDBInstance" else "modified"

        title = f"RDS instance `{db_id or 'unknown'}` {action_verb} by {event.actor}"
        if suspicious:
            title += f" — {', '.join(suspicious)}"

        findings.append(FindingDraft(
            check_id=CHECK_ID,
            resource_arn=resource_arn or f"arn:aws:rds:*:{acc.account_id or 'unknown'}:db",
            title=title,
            severity="high",
            risk_score=score("high"),
            evidence={
                "event_name": event.event_name,
                "event_time": event.event_time.isoformat(),
                "actor": event.actor,
                "source_ip": event.source_ip,
                "db_instance_id": db_id,
                "suspicious_changes": suspicious,
                "resource_arn": resource_arn,
            },
        ))

    return findings
