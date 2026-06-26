"""Collect GCP compute instances with public IP exposure."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.gcp_project import GcpComputeInstance, GcpProject
from app.services.gcp_client import GcpClient

log = structlog.get_logger()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _has_public_ip(instance: dict) -> bool:
    for nic in instance.get("networkInterfaces") or []:
        for access in nic.get("accessConfigs") or []:
            if access.get("natIP"):
                return True
    return False


def _zone_from_url(zone_url: str) -> str:
    return (zone_url or "").rsplit("/", 1)[-1]


def collect_compute_instances(db: Session, project: GcpProject) -> int:
    client = GcpClient(project.service_account_json)
    instances = client.list_compute_instances(project.project_id)
    count = 0
    for inst in instances:
        instance_id = str(inst.get("id") or inst.get("name") or "")
        if not instance_id:
            continue
        zone = _zone_from_url(inst.get("zone") or "")
        public_ip = _has_public_ip(inst)
        stmt = pg_insert(GcpComputeInstance).values(
            id=uuid.uuid5(uuid.NAMESPACE_URL, f"{project.id}:compute:{instance_id}"),
            gcp_project_id=project.id,
            instance_id=instance_id,
            name=str(inst.get("name") or instance_id),
            zone=zone,
            has_public_ip=public_ip,
            status=inst.get("status"),
            last_seen=_now(),
        ).on_conflict_do_update(
            index_elements=["gcp_project_id", "instance_id"],
            set_={
                "name": str(inst.get("name") or instance_id),
                "zone": zone,
                "has_public_ip": public_ip,
                "status": inst.get("status"),
                "last_seen": _now(),
            },
        )
        db.execute(stmt)
        count += 1
    log.info("collect_gcp_compute.done", project_id=project.project_id, instances=count)
    return count
