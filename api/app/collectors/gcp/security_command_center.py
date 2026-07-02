"""Collect GCP Security Command Center active findings summary."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.gcp_project import GcpProject, GcpSecurityCommandCenter
from app.services.gcp_client import GcpClient

log = structlog.get_logger()

_HIGH_SEVERITIES = {"HIGH", "CRITICAL"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def collect_security_command_center(db: Session, project: GcpProject) -> int:
    client = GcpClient.from_project(project)
    findings, status = client.list_scc_findings(project.project_id)
    scc_enabled = status is not None and status < 400
    active_count = len(findings) if scc_enabled else 0
    high_count = 0
    if scc_enabled:
        for row in findings:
            if client.scc_finding_severity(row) in _HIGH_SEVERITIES:
                high_count += 1

    stmt = pg_insert(GcpSecurityCommandCenter).values(
        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{project.id}:scc"),
        gcp_project_id=project.id,
        scc_enabled=scc_enabled,
        active_finding_count=active_count,
        high_severity_count=high_count,
        last_seen=_now(),
    ).on_conflict_do_update(
        index_elements=["gcp_project_id"],
        set_={
            "scc_enabled": scc_enabled,
            "active_finding_count": active_count,
            "high_severity_count": high_count,
            "last_seen": _now(),
        },
    )
    db.execute(stmt)
    log.info(
        "collect_gcp_scc.done",
        project_id=project.project_id,
        scc_enabled=scc_enabled,
        active_finding_count=active_count,
    )
    return active_count
