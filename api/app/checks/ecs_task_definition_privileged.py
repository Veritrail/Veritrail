from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.resources import EcsTaskDefinition

CHECK_ID = "ecs.task_definition.privileged_container"


def run(db: Session, account_id) -> list[FindingDraft]:
    rows = db.scalars(
        select(EcsTaskDefinition).where(
            EcsTaskDefinition.account_id == account_id,
            EcsTaskDefinition.has_privileged_container == True,  # noqa: E712
        )
    ).all()
    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=r.task_definition_arn,
            title=f"ECS task definition `{r.family}:{r.revision}` runs a privileged container",
            severity="high",
            risk_score=score("high"),
            evidence={
                "family": r.family,
                "revision": r.revision,
                "region": r.region,
                "has_privileged_container": r.has_privileged_container,
            },
        )
        for r in rows
    ]
