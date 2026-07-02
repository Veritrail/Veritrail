from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.gcp_project import GcpOsconfigVuln, GcpProject

CHECK_ID = "gcp.osconfig.vuln_report_present"


def run(db: Session, gcp_project_id) -> list[FindingDraft]:
    project = db.get(GcpProject, gcp_project_id)
    if not project:
        return []

    row = db.scalar(
        select(GcpOsconfigVuln).where(GcpOsconfigVuln.gcp_project_id == gcp_project_id)
    )
    if not row or not row.api_accessible or row.has_reports:
        return []

    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=f"gcp://project/{project.project_id}/osconfig",
            title="GCP OS Config vulnerability reports are not present",
            severity="medium",
            risk_score=score("medium"),
            evidence={
                "project_id": project.project_id,
                "report_count": row.report_count,
                "expectation": (
                    "OS Config vulnerability reports should be available for VM patch and vulnerability evidence."
                ),
            },
        )
    ]
