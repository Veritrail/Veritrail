from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.gcp_project import GcpComputeInstance, GcpProject

CHECK_ID = "gcp.compute.instance_public_ip"


def run(db: Session, gcp_project_id) -> list[FindingDraft]:
    project = db.get(GcpProject, gcp_project_id)
    if not project:
        return []

    exposed = db.scalars(
        select(GcpComputeInstance).where(
            GcpComputeInstance.gcp_project_id == gcp_project_id,
            GcpComputeInstance.has_public_ip == True,  # noqa: E712
        )
    ).all()

    drafts: list[FindingDraft] = []
    for inst in exposed:
        drafts.append(
            FindingDraft(
                check_id=CHECK_ID,
                resource_arn=f"gcp://compute/{project.project_id}/{inst.zone}/{inst.name}",
                title=f"GCP compute instance {inst.name} has a public IP",
                severity="high",
                risk_score=score("high"),
                evidence={
                    "project_id": project.project_id,
                    "instance_id": inst.instance_id,
                    "name": inst.name,
                    "zone": inst.zone,
                },
            )
        )
    return drafts
