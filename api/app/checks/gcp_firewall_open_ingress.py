from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.gcp_project import GcpComputeInstance, GcpFirewallRule, GcpProject

CHECK_ID = "gcp.firewall.open_ingress"


def _network_key(url: str | None) -> str:
    return (url or "").rsplit("/", 1)[-1]


def _rule_applies_to_instance(rule: GcpFirewallRule, inst: GcpComputeInstance) -> bool:
    inst_network = _network_key(inst.network)
    rule_network = _network_key(rule.network)
    if inst_network and rule_network and inst_network != rule_network:
        return False
    tags = list(inst.tags or [])
    target_tags = list(rule.target_tags or [])
    if target_tags:
        return bool(set(target_tags) & set(tags))
    return True


def run(db: Session, gcp_project_id) -> list[FindingDraft]:
    project = db.get(GcpProject, gcp_project_id)
    if not project:
        return []

    instances = db.scalars(
        select(GcpComputeInstance).where(
            GcpComputeInstance.gcp_project_id == gcp_project_id,
            GcpComputeInstance.has_public_ip == True,  # noqa: E712
        )
    ).all()
    if not instances:
        return []

    rules = db.scalars(
        select(GcpFirewallRule).where(
            GcpFirewallRule.gcp_project_id == gcp_project_id,
            GcpFirewallRule.allows_world_ingress == True,  # noqa: E712
        )
    ).all()
    if not rules:
        return []

    drafts: list[FindingDraft] = []
    for inst in instances:
        matching = [r for r in rules if _rule_applies_to_instance(r, inst)]
        if not matching:
            continue
        rule_names = [r.name for r in matching]
        drafts.append(
            FindingDraft(
                check_id=CHECK_ID,
                resource_arn=f"gcp://compute/{project.project_id}/{inst.zone}/{inst.name}",
                title=f"GCP instance {inst.name} is internet-reachable (public IP + open ingress)",
                severity="high",
                risk_score=score("high"),
                evidence={
                    "project_id": project.project_id,
                    "instance_id": inst.instance_id,
                    "name": inst.name,
                    "zone": inst.zone,
                    "network": inst.network,
                    "tags": inst.tags or [],
                    "matching_firewall_rules": rule_names,
                    "severity_basis": "external IP plus firewall rule(s) allowing 0.0.0.0/0 ingress",
                },
            )
        )
    return drafts
