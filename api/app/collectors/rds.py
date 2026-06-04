"""Collect RDS instance configuration per region."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from botocore.exceptions import ClientError
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.aws import assume_role
from app.models import AwsAccount
from app.models.resources import RdsInstance, RdsSnapshot

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


def collect_rds(db: Session, account: AwsAccount) -> int:
    sess = assume_role(account.role_arn, account.external_id, session_name="vigil-rds", aws_account=account, purpose="collect_rds")
    regions = _get_regions(sess)
    count = 0

    for region in regions:
        try:
            rds = sess.client("rds", region_name=region)
            paginator = rds.get_paginator("describe_db_instances")
            for page in paginator.paginate():
                for inst in page.get("DBInstances", []):
                    arn = inst["DBInstanceArn"]
                    stmt = pg_insert(RdsInstance).values(
                        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{arn}"),
                        account_id=account.id,
                        db_instance_id=inst["DBInstanceIdentifier"],
                        arn=arn,
                        region=region,
                        publicly_accessible=inst.get("PubliclyAccessible", False),
                        storage_encrypted=inst.get("StorageEncrypted", False),
                        backup_retention_period=inst.get("BackupRetentionPeriod", 0),
                        engine=inst.get("Engine"),
                        multi_az=inst.get("MultiAZ", False),
                        deletion_protection=inst.get("DeletionProtection", False),
                        last_seen=_now(),
                    ).on_conflict_do_update(
                        index_elements=["account_id", "arn"],
                        set_={
                            "publicly_accessible": inst.get("PubliclyAccessible", False),
                            "storage_encrypted": inst.get("StorageEncrypted", False),
                            "backup_retention_period": inst.get("BackupRetentionPeriod", 0),
                            "engine": inst.get("Engine"),
                            "multi_az": inst.get("MultiAZ", False),
                            "deletion_protection": inst.get("DeletionProtection", False),
                            "last_seen": _now(),
                        },
                    )
                    db.execute(stmt)
                    count += 1

            snap_paginator = rds.get_paginator("describe_db_snapshots")
            for page in snap_paginator.paginate(SnapshotType="manual"):
                for snap in page.get("DBSnapshots", []):
                    arn = snap.get("DBSnapshotArn")
                    snapshot_id = snap.get("DBSnapshotIdentifier")
                    if not arn or not snapshot_id:
                        continue
                    is_public = False
                    try:
                        attrs = rds.describe_db_snapshot_attributes(DBSnapshotIdentifier=snapshot_id)
                        for attr in attrs.get("DBSnapshotAttributesResult", {}).get("DBSnapshotAttributes", []):
                            if attr.get("AttributeName") == "restore" and "all" in (attr.get("AttributeValues") or []):
                                is_public = True
                                break
                    except ClientError:
                        pass
                    stmt = pg_insert(RdsSnapshot).values(
                        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{region}:{snapshot_id}"),
                        account_id=account.id,
                        region=region,
                        snapshot_id=snapshot_id,
                        arn=arn,
                        engine=snap.get("Engine"),
                        encrypted=snap.get("Encrypted", False),
                        is_public=is_public,
                        last_seen=_now(),
                    ).on_conflict_do_update(
                        index_elements=["account_id", "region", "snapshot_id"],
                        set_={
                            "engine": snap.get("Engine"),
                            "encrypted": snap.get("Encrypted", False),
                            "is_public": is_public,
                            "last_seen": _now(),
                        },
                    )
                    db.execute(stmt)
        except ClientError:
            continue

    db.commit()
    log.info("collect_rds.done", account_id=str(account.id), instances=count)
    return count
