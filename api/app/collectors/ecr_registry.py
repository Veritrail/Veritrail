"""Collect ECR registry-level scanning configuration per region."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from botocore.exceptions import ClientError
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.aws import assume_role
from app.models import AwsAccount
from app.models.resources import EcrRegistrySettings

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


def collect_ecr_registry_settings(db: Session, account: AwsAccount) -> int:
    sess = assume_role(
        account.role_arn,
        account.external_id,
        session_name="vigil-ecr-registry",
        aws_account=account,
        purpose="collect_ecr_registry_settings",
    )
    count = 0
    for region in _get_regions(sess):
        try:
            ecr = sess.client("ecr", region_name=region)
            cfg = ecr.get_registry_scanning_configuration()
            scanning = cfg.get("scanningConfiguration") or {}
            scan_type = scanning.get("scanType")
            enhanced = scan_type == "ENHANCED"
            stmt = pg_insert(EcrRegistrySettings).values(
                id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:ecr_registry:{region}"),
                account_id=account.id,
                region=region,
                scan_type=scan_type,
                enhanced_scanning_enabled=enhanced,
                last_seen=_now(),
            ).on_conflict_do_update(
                index_elements=["account_id", "region"],
                set_={
                    "scan_type": scan_type,
                    "enhanced_scanning_enabled": enhanced,
                    "last_seen": _now(),
                },
            )
            db.execute(stmt)
            count += 1
        except ClientError:
            continue

    log.info("collect_ecr_registry_settings.done", account_id=str(account.id), regions=count)
    return count
