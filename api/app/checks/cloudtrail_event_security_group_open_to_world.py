"""Check 6: Security Group Open-to-World Ingress — AuthorizeSecurityGroupIngress to 0.0.0.0/0 or ::/0."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import String, select, or_, cast
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models import AwsAccount
from app.models.cloudtrail import CloudTrailEvent

CHECK_ID = "cloudtrail.event.security_group_open_to_world"

# Ports that are especially dangerous when open to the world
_SENSITIVE_PORTS = frozenset({22, 3389, 3306, 5432, 27017, 6379, 1433, 1521, 1434, 143})


def _extract_ingress_details(raw: dict) -> list[dict]:
    """Parse ipPermissions from the raw CloudTrail event to extract CIDR/port details."""
    params = raw.get("requestParameters") or {}
    permissions = params.get("ipPermissions") or []
    if not isinstance(permissions, list):
        return []

    details: list[dict] = []
    for perm in permissions:
        ip_ranges = perm.get("ipRanges") or perm.get("IpRanges") or []
        ipv6_ranges = perm.get("ipv6Ranges") or perm.get("Ipv6Ranges") or []
        cidrs = [r.get("CidrIp") or r.get("cidrIp") or "" for r in ip_ranges]
        cidrs += [r.get("CidrIpv6") or r.get("cidrIpv6") or "" for r in ipv6_ranges]

        # Only interested in open-to-world rules
        world_cidrs = [c for c in cidrs if c in ("0.0.0.0/0", "::/0")]
        if not world_cidrs:
            continue

        from_port = perm.get("fromPort") or perm.get("FromPort")
        to_port = perm.get("toPort") or perm.get("ToPort")
        protocol = perm.get("ipProtocol") or perm.get("IpProtocol") or ""
        details.append({
            "protocol": protocol,
            "from_port": from_port,
            "to_port": to_port,
            "cidrs": world_cidrs,
            "sensitive": _is_sensitive_port(from_port, to_port, protocol),
        })
    return details


def _is_sensitive_port(from_port, to_port, protocol: str) -> bool:
    """Check if a rule opens sensitive ports."""
    if isinstance(from_port, int) and isinstance(to_port, int):
        # All traffic
        if protocol == "-1" and from_port == 0 and to_port == 65535:
            return True
        for port in range(from_port, to_port + 1):
            if port in _SENSITIVE_PORTS:
                return True
    return False


def run(db: Session, account_id) -> list[FindingDraft]:
    acc = db.get(AwsAccount, account_id)
    if not acc:
        return []

    lookback = datetime.now(timezone.utc) - timedelta(days=90)

    # Use JSONB containment for efficient filtering
    events = db.scalars(
        select(CloudTrailEvent)
        .where(
            CloudTrailEvent.account_id == account_id,
            CloudTrailEvent.event_time >= lookback,
            CloudTrailEvent.event_name == "AuthorizeSecurityGroupIngress",
            or_(
                cast(CloudTrailEvent.raw, String).ilike("%0.0.0.0/0%"),
                cast(CloudTrailEvent.raw, String).ilike("%::/0%"),
            ),
        )
        .order_by(CloudTrailEvent.event_time.desc())
    ).all()

    findings: list[FindingDraft] = []
    for event in events:
        sg_id = ""
        for r in (event.resources or []):
            rtype = (r.get("type") or "").lower()
            if "security" in rtype and "group" in rtype:
                sg_id = r.get("name") or ""
                break

        details = _extract_ingress_details(event.raw or {})
        has_sensitive = any(d.get("sensitive") for d in details)

        title_parts = [f"Security group `{sg_id or 'unknown'}` opened to the world"]
        if has_sensitive:
            title_parts.append("(sensitive ports exposed)")
        title = " ".join(title_parts)

        findings.append(FindingDraft(
            check_id=CHECK_ID,
            resource_arn=sg_id or f"arn:aws:ec2:*:{acc.account_id or 'unknown'}:security-group",
            title=title,
            severity="critical" if has_sensitive else "high",
            risk_score=score("critical" if has_sensitive else "high"),
            evidence={
                "event_name": event.event_name,
                "event_time": event.event_time.isoformat(),
                "actor": event.actor,
                "source_ip": event.source_ip,
                "security_group_id": sg_id,
                "ingress_rules": details,
                "has_sensitive_ports": has_sensitive,
            },
        ))

    return findings
