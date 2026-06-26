"""GCP client and collector tests with mocked HTTP."""
from __future__ import annotations

import json
import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.collectors.gcp.compute import collect_compute_instances
from app.collectors.gcp.logging_audit import collect_logging_audit
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
