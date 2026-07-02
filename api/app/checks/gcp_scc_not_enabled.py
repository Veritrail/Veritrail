from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.gcp_project import GcpProject, GcpSecurityCommandCenter

CHECK_ID = "gcp.scc.not_enabled"


def run(db: Session, gcp_project_id) -> list[FindingDraft]:
    project = db.get(GcpProject, gcp_project_id)
    if not project:
        return []

    row = db.scalar(
        select(GcpSecurityCommandCenter).where(
            GcpSecurityCommandCenter.gcp_project_id == gcp_project_id
        )
    )
    if row and row.scc_enabled:
        return []

    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=f"gcp://project/{project.project_id}/security-command-center",
            title="GCP Security Command Center is not enabled or not accessible",
            severity="medium",
            risk_score=score("medium"),
            evidence={
                "project_id": project.project_id,
                "active_finding_count": row.active_finding_count if row else 0,
                "expectation": (
                    "Security Command Center should be enabled with findings readable by the scanner role."
                ),
            },
        )
    ]
