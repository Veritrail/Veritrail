"""Collect AWS Config rule compliance (non-compliant rules)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from botocore.exceptions import ClientError
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.aws import assume_role
from app.models import AwsAccount
from app.models.resources import ConfigRuleCompliance

log = structlog.get_logger()

_MAX_RULES_PER_REGION = 200


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


def collect_config_compliance(db: Session, account: AwsAccount) -> int:
    sess = assume_role(
        account.role_arn,
        account.external_id,
        session_name="vigil-config-compliance",
        aws_account=account,
        purpose="collect_config_compliance",
    )
    regions = _get_regions(sess)
    count = 0

    for region in regions:
        try:
            client = sess.client("config", region_name=region)
            paginator = client.get_paginator("describe_compliance_by_config_rule")
            seen = 0
            for page in paginator.paginate(ComplianceTypes=["NON_COMPLIANT"]):
                for item in page.get("ComplianceByConfigRules", []):
                    if seen >= _MAX_RULES_PER_REGION:
                        break
                    rule_name = item.get("ConfigRuleName")
                    if not rule_name:
                        continue
                    compliance = (item.get("Compliance") or {}).get("ComplianceType", "NON_COMPLIANT")
                    stmt = pg_insert(ConfigRuleCompliance).values(
                        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:cfg:{region}:{rule_name}"),
                        account_id=account.id,
                        region=region,
                        rule_name=rule_name,
                        compliance_type=compliance,
                        last_seen=_now(),
                    ).on_conflict_do_update(
                        index_elements=["account_id", "region", "rule_name"],
                        set_={"compliance_type": compliance, "last_seen": _now()},
                    )
                    db.execute(stmt)
                    count += 1
                    seen += 1
                if seen >= _MAX_RULES_PER_REGION:
                    break
        except ClientError:
            continue


    log.info("collect_config_compliance.done", account_id=str(account.id), rules=count)
    return count
