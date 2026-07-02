"""GCP verify permission probe tests."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

from app.services.gcp_permission_probes import probe_gcp_scan_permissions


def test_probe_gcp_scan_permissions_reports_degraded_checks():
    project = MagicMock()
    project.id = uuid.uuid4()
    project.project_id = "demo-project"
    project.auth_method = "workload_identity"

    with patch("app.services.gcp_permission_probes.GcpClient") as client_cls:
        client = client_cls.from_project.return_value
        client.list_logging_sinks.return_value = []
        client.list_compute_instances.return_value = []
        client.list_osconfig_vuln_reports.return_value = ([], 403)
        client.list_scc_findings.return_value = ([], 200)
        client.list_cloud_asset_iam_policies.return_value = ([], 200)

        degraded = probe_gcp_scan_permissions(project)

    assert any(row["check_id"] == "gcp.osconfig.vuln_report_present" for row in degraded)
    assert all(row["api"] for row in degraded)
