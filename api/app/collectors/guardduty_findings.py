"""Collect active GuardDuty findings for incident-response evidence."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from botocore.exceptions import ClientError
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.aws import assume_role
from app.models import AwsAccount
from app.models.resources import GuardDutyFinding

log = structlog.get_logger()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _get_regions(sess) -> list[str]:
    ec2 = sess.client("ec2", region_name="us-east-1")
    return [
        r["RegionName"]
        for r in ec2.describe_regions(
            Filters=[{"Name": "opt-in-status", "Values": ["opt-in-not-required", "opted-in"]}]
        )["Regions"]
    ]


def collect_guardduty_findings(db: Session, account: AwsAccount, max_per_region: int = 100) -> int:
    sess = assume_role(
        account.role_arn,
        account.external_id,
        session_name="vigil-gd-findings",
        aws_account=account,
        purpose="collect_guardduty_findings",
    )
    regions = _get_regions(sess)
    count = 0

    for region in regions:
        try:
            gd = sess.client("guardduty", region_name=region)
            detector_ids = gd.list_detectors().get("DetectorIds", [])
            if not detector_ids:
                continue
            detector_id = detector_ids[0]
            finding_ids = gd.list_findings(
                DetectorId=detector_id,
                FindingCriteria={
                    "Criterion": {
                        "service.archived": {"Eq": ["false"]},
                    }
                },
                MaxResults=min(max_per_region, 50),
            ).get("FindingIds", [])
            if not finding_ids:
                continue

            details = gd.get_findings(DetectorId=detector_id, FindingIds=finding_ids).get("Findings", [])
            for f in details:
                finding_id = f.get("Id", "")
                if not finding_id:
                    continue
                resource = (f.get("Resource") or {})
                resource_arn = resource.get("InstanceDetails", {}).get("InstanceArn") or resource.get("AccessKeyDetails", {}).get("UserName")
                stmt = pg_insert(GuardDutyFinding).values(
                    id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:gd:{region}:{finding_id}"),
                    account_id=account.id,
                    region=region,
                    finding_id=finding_id,
                    finding_type=f.get("Type"),
                    severity=str(f.get("Severity", 0)),
                    title=f.get("Title"),
                    resource_arn=resource_arn if isinstance(resource_arn, str) else None,
                    archived=bool((f.get("Service") or {}).get("Archived", False)),
                    created_at=f.get("CreatedAt"),
                    updated_at=f.get("UpdatedAt"),
                    last_seen=_now(),
                ).on_conflict_do_update(
                    index_elements=["account_id", "region", "finding_id"],
                    set_={
                        "finding_type": f.get("Type"),
                        "severity": str(f.get("Severity", 0)),
                        "title": f.get("Title"),
                        "resource_arn": resource_arn if isinstance(resource_arn, str) else None,
                        "archived": bool((f.get("Service") or {}).get("Archived", False)),
                        "updated_at": f.get("UpdatedAt"),
                        "last_seen": _now(),
                    },
                )
                db.execute(stmt)
                count += 1
        except ClientError:
            continue


    log.info("collect_guardduty_findings.done", account_id=str(account.id), findings=count)
    return count
