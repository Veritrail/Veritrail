from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.resources import EcsService

CHECK_ID = "ecs.service.public_ip_enabled"


def run(db: Session, account_id) -> list[FindingDraft]:
    rows = db.scalars(
        select(EcsService).where(
            EcsService.account_id == account_id,
            EcsService.assign_public_ip == "ENABLED",
        )
    ).all()
    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=r.service_arn,
            title=f"ECS service `{r.service_name}` assigns a public IP to tasks",
            severity="high",
            risk_score=score("high"),
            evidence={
                "service_name": r.service_name,
                "cluster_name": r.cluster_name,
                "region": r.region,
                "assign_public_ip": r.assign_public_ip,
                "launch_type": r.launch_type,
                "status": r.status,
                "task_definition_arn": r.task_definition_arn,
            },
        )
        for r in rows
    ]
