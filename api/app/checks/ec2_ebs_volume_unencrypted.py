from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.resources import EbsVolume

CHECK_ID = "ec2.ebs.volume_unencrypted"


def run(db: Session, account_id) -> list[FindingDraft]:
    volumes = db.scalars(
        select(EbsVolume).where(
            EbsVolume.account_id == account_id,
            EbsVolume.encrypted == False,  # noqa: E712
        )
    ).all()

    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=volume.arn,
            title=f"EBS volume `{volume.volume_id}` is not encrypted",
            severity="medium",
            risk_score=score("medium"),
            evidence={
                "volume_id": volume.volume_id,
                "region": volume.region,
                "state": volume.state,
                "size_gib": volume.size_gib,
                "volume_type": volume.volume_type,
                "attached_instance_ids": volume.attached_instance_ids,
            },
        )
        for volume in volumes
    ]
