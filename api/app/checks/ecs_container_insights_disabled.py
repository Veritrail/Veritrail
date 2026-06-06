from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.resources import EcsCluster

CHECK_ID = "ecs.cluster.container_insights_disabled"


def run(db: Session, account_id) -> list[FindingDraft]:
    rows = db.scalars(
        select(EcsCluster).where(
            EcsCluster.account_id == account_id,
            EcsCluster.container_insights_enabled == False,  # noqa: E712
        )
    ).all()
    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=r.arn,
            title=f"ECS cluster `{r.name}` does not have Container Insights enabled",
            severity="low",
            risk_score=score("low"),
            evidence={
                "cluster_name": r.name,
                "region": r.region,
                "status": r.status,
                "container_insights_enabled": r.container_insights_enabled,
            },
        )
        for r in rows
    ]
