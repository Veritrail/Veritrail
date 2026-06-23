from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.resources import EksCluster

CHECK_ID = "eks.cluster.secrets_encryption_disabled"


def run(db: Session, account_id) -> list[FindingDraft]:
    rows = db.scalars(
        select(EksCluster).where(
            EksCluster.account_id == account_id,
            EksCluster.secrets_encryption_enabled == False,  # noqa: E712
        )
    ).all()
    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=r.arn,
            title=f"EKS cluster `{r.name}` does not use KMS envelope encryption for Kubernetes secrets",
            severity="medium",
            risk_score=score("medium"),
            evidence={
                "cluster_name": r.name,
                "region": r.region,
                "version": r.version,
            },
        )
        for r in rows
    ]
