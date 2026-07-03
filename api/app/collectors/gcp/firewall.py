"""Collect GCP VPC firewall rules with world-open ingress."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.gcp_project import GcpFirewallRule, GcpProject
from app.services.gcp_client import GcpClient

log = structlog.get_logger()

_WORLD_CIDRS = frozenset({"0.0.0.0/0", "::/0"})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def firewall_allows_world_ingress(rule: dict) -> bool:
    if rule.get("disabled"):
        return False
    direction = str(rule.get("direction") or "INGRESS").upper()
    if direction != "INGRESS":
        return False
    ranges = rule.get("sourceRanges") or []
    return any(str(r) in _WORLD_CIDRS for r in ranges)


def collect_firewall_rules(db: Session, project: GcpProject) -> int:
    client = GcpClient.from_project(project)
    rules = client.list_firewall_rules(project.project_id)
    count = 0
    for rule in rules:
        rule_id = str(rule.get("id") or rule.get("name") or "")
        if not rule_id:
            continue
        world_open = firewall_allows_world_ingress(rule)
        target_tags = list(rule.get("targetTags") or [])
        stmt = pg_insert(GcpFirewallRule).values(
            id=uuid.uuid5(uuid.NAMESPACE_URL, f"{project.id}:firewall:{rule_id}"),
            gcp_project_id=project.id,
            rule_id=rule_id,
            name=str(rule.get("name") or rule_id),
            network=str(rule.get("network") or ""),
            target_tags=target_tags or None,
            allows_world_ingress=world_open,
            last_seen=_now(),
        ).on_conflict_do_update(
            index_elements=["gcp_project_id", "rule_id"],
            set_={
                "name": str(rule.get("name") or rule_id),
                "network": str(rule.get("network") or ""),
                "target_tags": target_tags or None,
                "allows_world_ingress": world_open,
                "last_seen": _now(),
            },
        )
        db.execute(stmt)
        count += 1
    log.info("collect_gcp_firewall.done", project_id=project.project_id, rules=count)
    return count
