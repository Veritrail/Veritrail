from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models import AwsAccount
from app.models.resources import Ec2Instance

CHECK_ID = "ec2.instance.no_instance_profile"


def run(db: Session, account_id) -> list[FindingDraft]:
    acc = db.get(AwsAccount, account_id)
    if not acc:
        return []

    instances = db.scalars(
        select(Ec2Instance).where(
            Ec2Instance.account_id == account_id,
            Ec2Instance.iam_instance_profile_arn.is_(None),
            Ec2Instance.state == "running",
        )
    ).all()

    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=f"arn:aws:ec2:{i.region}:{acc.account_id or 'unknown'}:instance/{i.instance_id}",
            title=f"Instance `{i.instance_id}` has no IAM instance profile attached",
            severity="low",
            risk_score=score("low"),
            evidence={
                "instance_id": i.instance_id,
                "region": i.region,
                "instance_type": i.instance_type,
                "state": i.state,
                "note": (
                    "Workloads on this instance that call AWS APIs must be using "
                    "long-term access keys instead of an instance role. If the "
                    "instance never calls AWS APIs, attach no role and snooze."
                ),
            },
        )
        for i in instances
    ]
