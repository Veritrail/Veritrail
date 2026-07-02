from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.gcp_project import GcpCloudAsset, GcpProject

CHECK_ID = "gcp.asset.public_iam_binding"


def run(db: Session, gcp_project_id) -> list[FindingDraft]:
    project = db.get(GcpProject, gcp_project_id)
    if not project:
        return []

    exposed = db.scalars(
        select(GcpCloudAsset).where(
            GcpCloudAsset.gcp_project_id == gcp_project_id,
            GcpCloudAsset.has_public_iam == True,  # noqa: E712
        )
    ).all()

    drafts: list[FindingDraft] = []
    for asset in exposed:
        short_name = asset.asset_name.rsplit("/", 1)[-1]
        drafts.append(
            FindingDraft(
                check_id=CHECK_ID,
                resource_arn=f"gcp://asset/{project.project_id}/{short_name}",
                title=f"GCP asset {short_name} has a public IAM binding",
                severity="high",
                risk_score=score("high"),
                evidence={
                    "project_id": project.project_id,
                    "asset_name": asset.asset_name,
                    "asset_type": asset.asset_type,
                },
            )
        )
    return drafts
