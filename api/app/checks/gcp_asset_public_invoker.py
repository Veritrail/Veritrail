"""Public *invocation* endpoints: Cloud Functions / Cloud Run with an
allUsers/allAuthenticatedUsers invoker binding.

Split from gcp.asset.public_iam_binding: a public invoker is the standard GCP
pattern for exposing an HTTP endpoint (webhooks, API handlers), so it grades
medium — review that it is intended, not an incident. Public IAM on
data-holding assets stays in the sibling check at high.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.checks.gcp_asset_public_iam_binding import INVOCATION_ASSET_TYPES
from app.models.gcp_project import GcpCloudAsset, GcpProject

CHECK_ID = "gcp.asset.public_invoker"


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
        if not (asset.asset_type or "").startswith(INVOCATION_ASSET_TYPES):
            continue
        short_name = asset.asset_name.rsplit("/", 1)[-1]
        drafts.append(
            FindingDraft(
                check_id=CHECK_ID,
                resource_arn=f"gcp://asset/{project.project_id}/{short_name}",
                title=f"GCP service {short_name} is publicly invocable",
                severity="medium",
                risk_score=score("medium"),
                evidence={
                    "project_id": project.project_id,
                    "asset_name": asset.asset_name,
                    "asset_type": asset.asset_type,
                    "severity_basis": "public invocation endpoint (allUsers invoker is a standard pattern; verify it is intended)",
                },
            )
        )
    return drafts
