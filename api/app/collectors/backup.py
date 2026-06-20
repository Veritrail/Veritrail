"""Collect AWS Backup plans and vaults (read-only)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from botocore.exceptions import ClientError
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.aws import assume_role
from app.models import AwsAccount
from app.models.resources import BackupPlan

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


def collect_backup(db: Session, account: AwsAccount) -> dict[str, int]:
    sess = assume_role(
        account.role_arn,
        account.external_id,
        session_name="vigil-backup",
        aws_account=account,
        purpose="collect_backup",
    )
    regions = _get_regions(sess)
    plan_count = 0
    vault_count = 0

    for region in regions:
        try:
            backup = sess.client("backup", region_name=region)
            paginator = backup.get_paginator("list_backup_plans")
            for page in paginator.paginate():
                for plan in page.get("BackupPlansList", []):
                    plan_id = plan["BackupPlanId"]
                    plan_arn = plan.get("BackupPlanArn", "")
                    plan_name = plan.get("BackupPlanName")
                    stmt = pg_insert(BackupPlan).values(
                        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:backup:{region}:{plan_id}"),
                        account_id=account.id,
                        region=region,
                        plan_id=plan_id,
                        plan_arn=plan_arn,
                        plan_name=plan_name,
                        last_seen=_now(),
                    ).on_conflict_do_update(
                        index_elements=["account_id", "region", "plan_id"],
                        set_={
                            "plan_arn": plan_arn,
                            "plan_name": plan_name,
                            "last_seen": _now(),
                        },
                    )
                    db.execute(stmt)
                    plan_count += 1

            try:
                vault_paginator = backup.get_paginator("list_backup_vaults")
                for page in vault_paginator.paginate():
                    vault_count += len(page.get("BackupVaultList", []))
            except ClientError:
                pass
        except ClientError:
            continue


    log.info(
        "collect_backup.done",
        account_id=str(account.id),
        plans=plan_count,
        vaults=vault_count,
    )
    return {"backup_plans": plan_count, "backup_vaults": vault_count}
