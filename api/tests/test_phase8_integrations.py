"""Phase 8 integration tests."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.services.scanner_integrations import scanner_type_for_vendor, verify_scanner_connection
from app.services.siem_integrations import siem_type_for_vendor, verify_siem_connection
from app.services.snyk_shaped_scanner import fetch_aikido_findings, fetch_orca_findings, fetch_snyk_findings
from app.services.scanner_types import normalize_severity
from app.checks.okta_org_mfa import CHECK_ID as OKTA_MFA_CHECK


def test_scanner_types_for_new_vendors():
    assert scanner_type_for_vendor("snyk") == "scanner_snyk"
    assert scanner_type_for_vendor("orca") == "scanner_orca"
    assert scanner_type_for_vendor("aikido") == "scanner_aikido"


def test_siem_types():
    assert siem_type_for_vendor("splunk") == "siem_splunk"
    assert siem_type_for_vendor("datadog") == "siem_datadog"
    assert siem_type_for_vendor("elastic") == "siem_elastic"


def test_fetch_snyk_findings_maps_rows():
    cfg = {"org_id": "org-1", "api_token": "tok"}
    payload = {"data": [{"id": "issue-1", "attributes": {"title": "CVE-1", "effective_severity_level": "high"}}]}
    with patch("app.services.snyk_shaped_scanner.httpx.Client") as client_cls:
        client = MagicMock()
        client.__enter__.return_value = client
        client.__exit__.return_value = False
        client.get.return_value = MagicMock(status_code=200, json=lambda: payload)
        client_cls.return_value = client
        rows = fetch_snyk_findings(cfg)
    assert len(rows) == 1
    assert rows[0].external_id == "issue-1"
    assert normalize_severity(rows[0].severity) == "high"


def test_fetch_orca_findings_maps_alerts():
    cfg = {"api_token": "tok"}
    with patch("app.services.snyk_shaped_scanner.httpx.Client") as client_cls:
        client = MagicMock()
        client.__enter__.return_value = client
        client.__exit__.return_value = False
        client.get.return_value = MagicMock(
            status_code=200,
            json=lambda: [{"id": "a1", "title": "Public bucket", "severity": "critical"}],
        )
        client_cls.return_value = client
        rows = fetch_orca_findings(cfg)
    assert rows[0].title == "Public bucket"


def test_fetch_aikido_findings_maps_issues():
    cfg = {"api_token": "tok"}
    with patch("app.services.snyk_shaped_scanner.httpx.Client") as client_cls:
        client = MagicMock()
        client.__enter__.return_value = client
        client.__exit__.return_value = False
        client.get.return_value = MagicMock(
            status_code=200,
            json=lambda: {"issues": [{"id": 9, "title": "SQLi", "severity": "medium"}]},
        )
        client_cls.return_value = client
        rows = fetch_aikido_findings(cfg)
    assert rows[0].external_id == "9"


def test_snyk_verify_requires_org_id():
    with pytest.raises(ValueError, match="org_id"):
        verify_scanner_connection("snyk", {"api_token": "x"})


def test_splunk_verify_requires_credentials():
    with pytest.raises(ValueError, match="base_url"):
        verify_siem_connection("splunk", {})


def test_okta_mfa_check_id():
    assert OKTA_MFA_CHECK == "okta.org.mfa_not_enforced"


def test_datadog_verify_mock():
    with patch("app.services.siem_integrations.httpx.Client") as client_cls:
        client = MagicMock()
        client.__enter__.return_value = client
        client.__exit__.return_value = False
        client.get.return_value = MagicMock(status_code=200)
        client_cls.return_value = client
        out = verify_siem_connection("datadog", {"api_key": "a", "app_key": "b"})
    assert out["ok"] is True
