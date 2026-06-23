"""Collect Amazon Inspector v2 account status and active high-severity findings."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from botocore.exceptions import ClientError
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.aws import assume_role
from app.models import AwsAccount
from app.models.resources import InspectorAccountStatus, InspectorFinding

log = structlog.get_logger()

_MAX_FINDINGS_PER_REGION = 100


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


def _resource_enabled(state: dict | None) -> bool:
    if not state:
        return False
    return str(state.get("status", "")).upper() == "ENABLED"


def collect_inspector(db: Session, account: AwsAccount) -> dict:
    sess = assume_role(
        account.role_arn,
        account.external_id,
        session_name="veritrail-inspector",
        aws_account=account,
        purpose="collect_inspector",
    )
    aws_account_id = account.account_id
    if not aws_account_id:
        sts = sess.client("sts")
        aws_account_id = sts.get_caller_identity()["Account"]

    status_count = finding_count = 0
    for region in _get_regions(sess):
        try:
            inspector = sess.client("inspector2", region_name=region)
            status_resp = inspector.batch_get_account_status(accountIds=[aws_account_id])
            accounts = status_resp.get("accounts") or []
            if not accounts:
                continue
            acct = accounts[0]
            resource_state = acct.get("resourceState") or {}
            ecr_on = _resource_enabled(resource_state.get("ecr"))
            ec2_on = _resource_enabled(resource_state.get("ec2"))
            lambda_on = _resource_enabled(resource_state.get("lambda"))
            stmt = pg_insert(InspectorAccountStatus).values(
                id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:inspector:{region}"),
                account_id=account.id,
                region=region,
                ecr_enabled=ecr_on,
                ec2_enabled=ec2_on,
                lambda_enabled=lambda_on,
                last_seen=_now(),
            ).on_conflict_do_update(
                index_elements=["account_id", "region"],
                set_={
                    "ecr_enabled": ecr_on,
                    "ec2_enabled": ec2_on,
                    "lambda_enabled": lambda_on,
                    "last_seen": _now(),
                },
            )
            db.execute(stmt)
            status_count += 1

            if not (ecr_on or ec2_on or lambda_on):
                continue

            paginator = inspector.get_paginator("list_findings")
            collected = 0
            for page in paginator.paginate(
                filterCriteria={
                    "findingStatus": [{"comparison": "EQUALS", "value": "ACTIVE"}],
                },
                maxResults=50,
            ):
                arns = page.get("findings") or []
                if not arns:
                    continue
                try:
                    detail = inspector.batch_get_finding_details(findingArns=arns[:10])
                except ClientError:
                    continue
                for item in detail.get("findings") or []:
                    if collected >= _MAX_FINDINGS_PER_REGION:
                        break
                    summary = item.get("findingSummary") or item
                    severity = str(summary.get("severity", "")).upper()
                    if severity not in {"CRITICAL", "HIGH"}:
                        continue
                    finding_arn = item.get("findingArn") or summary.get("findingArn")
                    if not finding_arn:
                        continue
                    title = summary.get("title")
                    resource_type = summary.get("resourceType")
                    resource_id = summary.get("resourceId")
                    fix_available = bool(summary.get("fixAvailable") == "YES")
                    stmt = pg_insert(InspectorFinding).values(
                        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{finding_arn}"),
                        account_id=account.id,
                        region=region,
                        finding_arn=finding_arn,
                        resource_type=resource_type,
                        severity=severity,
                        title=title,
                        resource_id=resource_id,
                        fix_available=fix_available,
                        last_seen=_now(),
                    ).on_conflict_do_update(
                        index_elements=["account_id", "finding_arn"],
                        set_={
                            "resource_type": resource_type,
                            "severity": severity,
                            "title": title,
                            "resource_id": resource_id,
                            "fix_available": fix_available,
                            "last_seen": _now(),
                        },
                    )
                    db.execute(stmt)
                    finding_count += 1
                    collected += 1
                if collected >= _MAX_FINDINGS_PER_REGION:
                    break
        except ClientError:
            continue


    log.info(
        "collect_inspector.done",
        account_id=str(account.id),
        regions=status_count,
        findings=finding_count,
    )
    return {"regions": status_count, "findings": finding_count}
