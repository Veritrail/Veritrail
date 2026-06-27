"""Collect GCP audit-log export sink evidence.

Admin Activity audit logs are written by GCP by default. This collector only
checks whether audit logs appear to be routed/exported for retention/review.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.gcp_project import GcpLoggingAudit, GcpProject
from app.services.gcp_client import GcpClient

log = structlog.get_logger()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _audit_enabled(sinks: list[dict]) -> bool:
    for sink in sinks:
        name = (sink.get("name") or "").lower()
        destination = (sink.get("destination") or "").lower()
        filt = str(sink.get("filter") or "").lower()
        if "audit" in name or "audit" in destination:
            return True
        if "cloudaudit.googleapis.com" in filt:
            return True
    return False


def collect_logging_audit(db: Session, project: GcpProject) -> int:
    client = GcpClient.from_project(project)
    sinks = client.list_logging_sinks(project.project_id)
    enabled = _audit_enabled(sinks)
    stmt = pg_insert(GcpLoggingAudit).values(
        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{project.id}:logging_audit"),
        gcp_project_id=project.id,
        audit_logging_enabled=enabled,
        sink_count=len(sinks),
        last_seen=_now(),
    ).on_conflict_do_update(
        index_elements=["gcp_project_id"],
        set_={
            "audit_logging_enabled": enabled,
            "sink_count": len(sinks),
            "last_seen": _now(),
        },
    )
    db.execute(stmt)
    log.info("collect_gcp_logging_audit.done", project_id=project.project_id, sinks=len(sinks))
    return len(sinks)
