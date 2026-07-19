"""Collect GCP OS Config vulnerability reports for VM patch/vuln evidence."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.gcp_project import GcpOsconfigVuln, GcpProject
from app.services.gcp_client import GcpClient

log = structlog.get_logger()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _count_severities(reports: list[dict]) -> dict[str, int]:
    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for report in reports:
        vulns = report.get("vulnerabilities") or report.get("vulnerabilityReport", {}).get("vulnerabilities") or []
        if not isinstance(vulns, list):
            continue
        for v in vulns:
            details = v.get("details") if isinstance(v, dict) else None
            sev = ""
            if isinstance(details, dict):
                sev = str(details.get("severity") or details.get("cvssV3Severity") or "").upper()
            elif isinstance(v, dict):
                sev = str(v.get("severity") or "").upper()
            key = sev.lower()
            if key in counts:
                counts[key] += 1
            elif key:
                counts["low"] += 1
    return counts


def collect_osconfig_vuln(db: Session, project: GcpProject) -> int:
    client = GcpClient.from_project(project)
    reports, status = client.list_osconfig_vuln_reports(project.project_id)
    api_accessible = status is not None and status < 400
    report_count = len(reports) if api_accessible else 0
    has_reports = report_count > 0
    evidence: dict = {
        "api_status": status,
        "limitations": [],
    }
    if status == 403:
        evidence["limitations"].append("osconfig_permission_denied")
    elif status is not None and status >= 400:
        evidence["limitations"].append(f"osconfig_api_status_{status}")
    if api_accessible:
        evidence.update(_count_severities(reports))
        evidence["report_sample_ids"] = [
            str(r.get("name") or "") for r in reports[:5] if isinstance(r, dict)
        ]

    stmt = pg_insert(GcpOsconfigVuln).values(
        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{project.id}:osconfig_vuln"),
        gcp_project_id=project.id,
        api_accessible=api_accessible,
        report_count=report_count,
        has_reports=has_reports,
        evidence_json=evidence,
        last_seen=_now(),
    ).on_conflict_do_update(
        index_elements=["gcp_project_id"],
        set_={
            "api_accessible": api_accessible,
            "report_count": report_count,
            "has_reports": has_reports,
            "evidence_json": evidence,
            "last_seen": _now(),
        },
    )
    db.execute(stmt)
    log.info(
        "collect_gcp_osconfig_vuln.done",
        project_id=project.project_id,
        report_count=report_count,
        api_accessible=api_accessible,
    )
    return report_count
