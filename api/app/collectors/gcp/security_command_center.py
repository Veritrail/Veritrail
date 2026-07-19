"""Collect GCP Security Command Center active findings summary with class depth."""
from __future__ import annotations

import uuid
from collections import Counter
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


def _finding_class(row: dict) -> str:
    finding = row.get("finding") if isinstance(row.get("finding"), dict) else row
    finding = finding or {}
    cls = str(finding.get("findingClass") or finding.get("category") or "").upper()
    if "VULN" in cls:
        return "vulnerability"
    if "MISCONFIG" in cls or "SECURITY_HEALTH" in cls:
        return "misconfiguration"
    if "THREAT" in cls or "MALWARE" in cls:
        return "threat"
    return "other"


def collect_security_command_center(db: Session, project: GcpProject) -> int:
    client = GcpClient.from_project(project)
    findings, status = client.list_scc_findings(project.project_id)
    scc_enabled = status is not None and status < 400
    active_count = len(findings) if scc_enabled else 0
    high_count = 0
    class_counts: Counter[str] = Counter()
    sev_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    sources: set[str] = set()
    muted = 0
    if scc_enabled:
        for row in findings:
            finding = row.get("finding") if isinstance(row.get("finding"), dict) else row
            finding = finding or {}
            sev = client.scc_finding_severity(row)
            if sev in _HIGH_SEVERITIES:
                high_count += 1
            sev_key = sev.lower()
            if sev_key in sev_counts:
                sev_counts[sev_key] += 1
            elif sev:
                sev_counts["low"] += 1
            class_counts[_finding_class(row)] += 1
            src = str(finding.get("sourceProperties", {}).get("sourceId") or finding.get("parent") or "")
            if src:
                sources.add(src.split("/")[-1] if "/" in src else src)
            mute = str(finding.get("mute") or "").upper()
            if mute == "MUTED":
                muted += 1

    evidence = {
        "api_status": status,
        "finding_classes": dict(class_counts),
        "vulnerability_finding_count": int(class_counts.get("vulnerability", 0)),
        "misconfiguration_finding_count": int(class_counts.get("misconfiguration", 0)),
        "threat_finding_count": int(class_counts.get("threat", 0)),
        "sources_observed": sorted(sources)[:20],
        "vulnerability_sources": sorted(sources)[:20] if class_counts.get("vulnerability") else [],
        "muted_count": muted,
        "limitations": [],
        **sev_counts,
    }
    if status == 403:
        evidence["limitations"].append("scc_permission_denied")
    elif status is not None and status >= 400:
        evidence["limitations"].append(f"scc_api_status_{status}")
    if scc_enabled and not class_counts.get("vulnerability"):
        evidence["limitations"].append("scc_no_vulnerability_class_findings")

    stmt = pg_insert(GcpSecurityCommandCenter).values(
        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{project.id}:scc"),
        gcp_project_id=project.id,
        scc_enabled=scc_enabled,
        active_finding_count=active_count,
        high_severity_count=high_count,
        evidence_json=evidence,
        last_seen=_now(),
    ).on_conflict_do_update(
        index_elements=["gcp_project_id"],
        set_={
            "scc_enabled": scc_enabled,
            "active_finding_count": active_count,
            "high_severity_count": high_count,
            "evidence_json": evidence,
            "last_seen": _now(),
        },
    )
    db.execute(stmt)
    log.info(
        "collect_gcp_scc.done",
        project_id=project.project_id,
        scc_enabled=scc_enabled,
        active_finding_count=active_count,
        finding_classes=dict(class_counts),
    )
    return active_count
