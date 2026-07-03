"""Integration input normalization tests."""
from __future__ import annotations

import pytest

from app.services.integration_input import (
    normalize_api_base_url,
    normalize_azure_devops_org_url,
    normalize_azure_devops_project,
    normalize_datadog_site,
    normalize_okta_org_url,
    normalize_snyk_org_id,
)


def test_normalize_api_base_url_strips_path():
    assert normalize_api_base_url("https://splunk.example.com:8089/en-US/app/search") == (
        "https://splunk.example.com:8089"
    )


def test_normalize_okta_org_url_strips_admin_path():
    assert normalize_okta_org_url("https://acme.okta.com/admin/dashboard") == "https://acme.okta.com"


def test_normalize_azure_devops_org_url_from_project_url():
    assert normalize_azure_devops_org_url("https://dev.azure.com/myorg/MyProject") == (
        "https://dev.azure.com/myorg"
    )


def test_normalize_azure_devops_project_from_url():
    assert normalize_azure_devops_project("https://dev.azure.com/myorg/MyProject/_boards") == "MyProject"


def test_normalize_datadog_site_from_app_url():
    assert normalize_datadog_site("https://app.datadoghq.eu") == "datadoghq.eu"


def test_normalize_snyk_org_id_from_org_url():
    assert normalize_snyk_org_id("https://app.snyk.io/org/my-org-slug") == "my-org-slug"


def test_normalize_okta_org_url_rejects_non_okta():
    with pytest.raises(ValueError, match="Okta org URL"):
        normalize_okta_org_url("https://example.com")
