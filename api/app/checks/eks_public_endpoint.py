from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.resources import EksCluster

CHECK_ID = "eks.cluster.public_endpoint"
_OPEN_CIDRS = {"0.0.0.0/0", "::/0"}


def run(db: Session, account_id) -> list[FindingDraft]:
    rows = db.scalars(
        select(EksCluster).where(
            EksCluster.account_id == account_id,
            EksCluster.endpoint_public_access == True,  # noqa: E712
        )
    ).all()
    exposed = [r for r in rows if _OPEN_CIDRS.intersection(set(r.public_access_cidrs or []))]
    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=r.arn,
            title=f"EKS cluster `{r.name}` API endpoint is public to the internet",
            severity="high",
            risk_score=score("high"),
            evidence={
                "cluster_name": r.name,
                "region": r.region,
                "public_access_cidrs": r.public_access_cidrs or [],
                "endpoint_private_access": r.endpoint_private_access,
                "version": r.version,
                "status": r.status,
            },
        )
        for r in exposed
    ]
