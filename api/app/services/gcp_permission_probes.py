"""Probe GCP scan APIs during verify and report degraded checks."""
from __future__ import annotations

from typing import Any, Callable

from app.models.gcp_project import GcpProject
from app.services.gcp_client import GcpClient

ProbeFn = Callable[[GcpClient, str], tuple[Any, int | None]]

_GCP_SCAN_PROBES: list[tuple[str, str, ProbeFn]] = [
    ("logging", "gcp.logging.not_enabled", lambda c, p: (c.list_logging_sinks(p), 200)),
    ("compute", "gcp.compute.instance_public_ip", lambda c, p: (c.list_compute_instances(p), 200)),
    ("osconfig", "gcp.osconfig.vuln_report_present", lambda c, p: c.list_osconfig_vuln_reports(p)),
    ("security_command_center", "gcp.scc.not_enabled", lambda c, p: c.list_scc_findings(p)),
    ("cloud_asset_inventory", "gcp.asset.public_iam_binding", lambda c, p: c.list_cloud_asset_iam_policies(p)),
]


def probe_gcp_scan_permissions(project: GcpProject) -> list[dict[str, str]]:
    """Return degraded checks when an API is unreachable due to missing IAM permissions."""
    client = GcpClient.from_project(project)
    degraded: list[dict[str, str]] = []
    for api_name, check_id, probe in _GCP_SCAN_PROBES:
        try:
            _payload, status = probe(client, project.project_id)
            if status is not None and status >= 400:
                degraded.append(
                    {
                        "check_id": check_id,
                        "api": api_name,
                        "reason": f"GCP API returned HTTP {status} — grant the scanner role access to {api_name}.",
                    }
                )
        except ValueError as exc:
            degraded.append(
                {
                    "check_id": check_id,
                    "api": api_name,
                    "reason": str(exc),
                }
            )
    return degraded
