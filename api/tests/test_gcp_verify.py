"""GCP project verify route tests."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

from app.models.gcp_project import GcpProject
from app.routes.gcp_integration import verify_gcp_project
from app.services.gcp_impersonation import AUTH_SERVICE_ACCOUNT_IMPERSONATION


def test_verify_gcp_project_connected_when_optional_apis_lack_permission():
    """Core verify must succeed even when Release 3 APIs only report degraded checks."""
    org_id = uuid.uuid4()
    project_row_id = uuid.uuid4()
    row = GcpProject(
        id=project_row_id,
        org_id=org_id,
        project_id="carwiz-97e29",
        label="carwiz",
        auth_method=AUTH_SERVICE_ACCOUNT_IMPERSONATION,
        service_account_email="veritrail-scanner@carwiz-97e29.iam.gserviceaccount.com",
        status="pending",
    )
    db = MagicMock()
    db.get.return_value = row

    degraded = [
        {
            "check_id": "gcp.logging.not_enabled",
            "api": "logging",
            "reason": "GCP credentials lack required permissions",
        }
    ]

    org = MagicMock()
    org.id = org_id

    with (
        patch("app.routes.gcp_integration._get_org", return_value=org),
        patch("app.routes.gcp_integration.GcpClient") as client_cls,
        patch("app.routes.gcp_integration.platform_sa_config_error", return_value=None),
        patch("app.services.gcp_permission_probes.probe_gcp_scan_permissions", return_value=degraded) as probe,
    ):
        client = client_cls.from_project.return_value
        client.verify.return_value = {
            "project_id": "carwiz-97e29",
            "name": "carwiz",
            "project_number": "123456789",
        }

        result = verify_gcp_project(
            project_row_id,
            _rbac=MagicMock(),
            p={"org_id": str(org_id)},
            db=db,
        )

    assert result["ok"] is True
    assert result["degraded_checks"] == degraded
    assert row.status == "connected"
    assert row.last_error is None
    client.list_logging_sinks.assert_not_called()
    probe.assert_called_once_with(row)
    db.commit.assert_called()
