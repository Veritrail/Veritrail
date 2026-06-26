from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.gcp_project import GcpLoggingAudit, GcpProject

CHECK_ID = "gcp.logging.not_enabled"


def run(db: Session, gcp_project_id) -> list[FindingDraft]:
    project = db.get(GcpProject, gcp_project_id)
    if not project:
        return []

    row = db.scalar(
        select(GcpLoggingAudit).where(GcpLoggingAudit.gcp_project_id == gcp_project_id)
    )
    if row and row.audit_logging_enabled:
        return []

    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=f"gcp://project/{project.project_id}/logging",
            title="GCP audit logging is not enabled",
            severity="medium",
            risk_score=score("medium"),
            evidence={
                "project_id": project.project_id,
                "sink_count": row.sink_count if row else 0,
            },
        )
    ]
