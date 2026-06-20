"""Collect GuardDuty detector status per region."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from botocore.exceptions import ClientError
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.aws import assume_role
from app.models import AwsAccount
from app.models.resources import GuardDutyDetector

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


def collect_guardduty(db: Session, account: AwsAccount) -> int:
    sess = assume_role(account.role_arn, account.external_id, session_name="vigil-guardduty", aws_account=account, purpose="collect_guardduty")
    regions = _get_regions(sess)
    count = 0

    for region in regions:
        try:
            gd = sess.client("guardduty", region_name=region)
            detector_ids = gd.list_detectors().get("DetectorIds", [])

            if not detector_ids:
                # No detector in this region — record as disabled
                stmt = pg_insert(GuardDutyDetector).values(
                    id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:guardduty:{region}:none"),
                    account_id=account.id,
                    detector_id="none",
                    region=region,
                    status="DISABLED",
                    last_seen=_now(),
                ).on_conflict_do_update(
                    index_elements=["account_id", "detector_id", "region"],
                    set_={"status": "DISABLED", "last_seen": _now()},
                )
                db.execute(stmt)
                count += 1
            else:
                for det_id in detector_ids:
                    try:
                        det = gd.get_detector(DetectorId=det_id)
                        status = det.get("Status", "DISABLED")
                    except ClientError:
                        status = "DISABLED"

                    stmt = pg_insert(GuardDutyDetector).values(
                        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:guardduty:{region}:{det_id}"),
                        account_id=account.id,
                        detector_id=det_id,
                        region=region,
                        status=status,
                        last_seen=_now(),
                    ).on_conflict_do_update(
                        index_elements=["account_id", "detector_id", "region"],
                        set_={"status": status, "last_seen": _now()},
                    )
                    db.execute(stmt)
                    count += 1
        except ClientError:
            continue


    log.info("collect_guardduty.done", account_id=str(account.id), records=count)
    return count
