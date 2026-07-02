"""GCP client and collector tests with mocked HTTP."""
from __future__ import annotations

import json
import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.collectors.gcp.cloud_asset_inventory import collect_cloud_asset_inventory
from app.collectors.gcp.compute import collect_compute_instances
from app.collectors.gcp.logging_audit import _audit_enabled, collect_logging_audit
from app.collectors.gcp.osconfig_vuln import collect_osconfig_vuln
from app.collectors.gcp.security_command_center import collect_security_command_center
from app.services.gcp_client import GcpClient

_SA = {
    "type": "service_account",
    "project_id": "demo-project",
    "client_email": "sa@demo-project.iam.gserviceaccount.com",
    "private_key": "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n",
}


def _resp(status_code: int = 200, payload: dict | None = None) -> MagicMock:
    r = MagicMock()
    r.status_code = status_code
    r.content = b"{}"
    r.text = ""
    r.json.return_value = payload or {}
    return r


def test_gcp_client_verify_project():
    with patch.object(GcpClient, "_access_token", return_value="tok"):
        with patch("app.services.gcp_client.httpx.Client") as client_cls:
            client = MagicMock()
            client.__enter__.return_value = client
            client.__exit__.return_value = False
            client.request.return_value = _resp(payload={"projectId": "demo-project", "name": "Demo"})
            client_cls.return_value = client
            out = GcpClient(json.dumps(_SA)).verify("demo-project")
    assert out["project_id"] == "demo-project"


def test_collect_logging_audit_upserts(mock_db):
    project = MagicMock()
    project.id = uuid.uuid4()
    project.project_id = "demo-project"
    project.auth_method = "workload_identity"

    with patch("app.collectors.gcp.logging_audit.GcpClient") as client_cls:
        client_cls.from_project.return_value.list_logging_sinks.return_value = [
            {"name": "audit-sink", "destination": "logging.googleapis.com/projects/demo-project/audit"}
        ]
        count = collect_logging_audit(mock_db, project)
    assert count == 1
    mock_db.execute.assert_called()


def test_generic_logging_sink_does_not_count_as_audit_export():
    assert not _audit_enabled([
        {"name": "all-logs", "destination": "storage.googleapis.com/generic-logs"}
    ])
    assert _audit_enabled([
        {
            "name": "security-audit",
            "filter": 'logName:"cloudaudit.googleapis.com%2Factivity"',
        }
    ])


def test_collect_compute_instances_flags_public_ip(mock_db):
    project = MagicMock()
    project.id = uuid.uuid4()
    project.project_id = "demo-project"
    project.auth_method = "workload_identity"

    instance = {
        "id": "123",
        "name": "web-1",
        "zone": "https://www.googleapis.com/compute/v1/projects/demo-project/zones/us-central1-a",
        "status": "RUNNING",
        "networkInterfaces": [{"accessConfigs": [{"natIP": "203.0.113.10"}]}],
    }
    with patch("app.collectors.gcp.compute.GcpClient") as client_cls:
        client_cls.from_project.return_value.list_compute_instances.return_value = [instance]
        count = collect_compute_instances(mock_db, project)
    assert count == 1
    mock_db.execute.assert_called()


def test_collect_osconfig_vuln_upserts(mock_db):
    project = MagicMock()
    project.id = uuid.uuid4()
    project.project_id = "demo-project"
    project.auth_method = "workload_identity"

    with patch("app.collectors.gcp.osconfig_vuln.GcpClient") as client_cls:
        client_cls.from_project.return_value.list_osconfig_vuln_reports.return_value = (
            [{"name": "projects/demo/locations/us-central1-a/vulnerabilityReports/r1"}],
            200,
        )
        count = collect_osconfig_vuln(mock_db, project)
    assert count == 1
    mock_db.execute.assert_called()


def test_collect_security_command_center_counts_high_findings(mock_db):
    project = MagicMock()
    project.id = uuid.uuid4()
    project.project_id = "demo-project"
    project.auth_method = "workload_identity"

    findings = [
        {"finding": {"severity": "HIGH"}},
        {"finding": {"severity": "MEDIUM"}},
    ]
    with patch("app.collectors.gcp.security_command_center.GcpClient") as client_cls:
        client = client_cls.from_project.return_value
        client.list_scc_findings.return_value = (findings, 200)
        client.scc_finding_severity.side_effect = GcpClient.scc_finding_severity
        count = collect_security_command_center(mock_db, project)
    assert count == 2
    mock_db.execute.assert_called()


def test_collect_cloud_asset_inventory_flags_public_iam(mock_db):
    project = MagicMock()
    project.id = uuid.uuid4()
    project.project_id = "demo-project"
    project.auth_method = "workload_identity"

    assets = [
        {
            "name": "//storage.googleapis.com/demo-bucket",
            "assetType": "storage.googleapis.com/Bucket",
            "iamPolicy": {"bindings": [{"members": ["allUsers"], "role": "roles/storage.objectViewer"}]},
        }
    ]
    with patch("app.collectors.gcp.cloud_asset_inventory.GcpClient") as client_cls:
        client = client_cls.from_project.return_value
        client.list_cloud_asset_iam_policies.return_value = (assets, 200)
        client.asset_has_public_iam.side_effect = GcpClient.asset_has_public_iam
        count = collect_cloud_asset_inventory(mock_db, project)
    assert count == 1
    mock_db.execute.assert_called()


def test_gcp_client_asset_has_public_iam():
    assert GcpClient.asset_has_public_iam(
        {"iamPolicy": {"bindings": [{"members": ["allUsers"], "role": "roles/viewer"}]}}
    )
    assert not GcpClient.asset_has_public_iam(
        {"iamPolicy": {"bindings": [{"members": ["user:alice@example.com"], "role": "roles/viewer"}]}}
    )
