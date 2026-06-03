from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models import AwsAccount
from app.models.resources import SecurityGroup

CHECK_ID = "ec2.security_group.unrestricted_ssh"


def run(db: Session, account_id) -> list[FindingDraft]:
    acc = db.get(AwsAccount, account_id)
    if not acc:
        return []

    sgs = db.scalars(
        select(SecurityGroup).where(
            SecurityGroup.account_id == account_id,
            SecurityGroup.unrestricted_ssh == True,  # noqa: E712
        )
    ).all()

    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=f"arn:aws:ec2:{sg.region}:{acc.account_id or 'unknown'}:security-group/{sg.group_id}",
            title=f"Security group `{sg.group_name}` allows unrestricted SSH (0.0.0.0/0 on port 22)",
            severity="high",
            risk_score=score("high"),
            evidence={
                "group_id": sg.group_id,
                "group_name": sg.group_name,
                "region": sg.region,
                "vpc_id": sg.vpc_id,
                "exposing_rules": (sg.public_exposure or {}).get("ssh") or [],
            },
        )
        for sg in sgs
    ]
