"""GCP service account impersonation tests."""
from __future__ import annotations

import json
import sys
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest

from app.services.gcp_client import GcpClient
from app.services.gcp_impersonation import (
    AUTH_SERVICE_ACCOUNT_IMPERSONATION,
    exchange_impersonation_access_token,
    impersonation_setup_manifest,
    is_platform_sa_configured,
    platform_sa_config_error,
)
from app.services.gcp_wif import AUTH_WORKLOAD_IDENTITY

_PLATFORM_SA = {
    "type": "service_account",
    "project_id": "veritrail-prod",
    "client_email": "platform@veritrail-prod.iam.gserviceaccount.com",
    "private_key": "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n",
}


def test_impersonation_setup_manifest():
    manifest = impersonation_setup_manifest(project_id="customer-proj")
    assert manifest["auth_method"] == AUTH_SERVICE_ACCOUNT_IMPERSONATION
    assert manifest["project_id"] == "customer-proj"
    assert manifest["scanner_sa_email"] == "veritrail-scanner@customer-proj.iam.gserviceaccount.com"
    assert manifest["terraform_path"] == "infra/gcp/sa-setup"


def test_platform_sa_config_error_when_unset():
    with patch("app.services.gcp_impersonation.get_settings") as gs:
        settings = MagicMock()
        settings.APP_ENV = "dev"
        settings.VERITRAIL_GCP_PLATFORM_SA_EMAIL = ""
        settings.VERITRAIL_GCP_PLATFORM_SA_JSON = ""
        settings.VERITRAIL_GCP_PLATFORM_SA_JSON_PATH = ""
        gs.return_value = settings
        assert is_platform_sa_configured() is False
        err = platform_sa_config_error()
        assert err and "VERITRAIL_GCP_PLATFORM_SA_JSON" in err


def test_exchange_impersonation_access_token_mocked():
    creds = MagicMock()
    creds.token = "impersonated-access-token"

    impersonated_credentials = ModuleType("google.auth.impersonated_credentials")
    impersonated_credentials.Credentials = MagicMock(return_value=creds)
    transport_requests = ModuleType("google.auth.transport.requests")
    transport_requests.Request = MagicMock()
    service_account = ModuleType("google.oauth2.service_account")
    service_account.Credentials = MagicMock(return_value=MagicMock())

    google_auth = ModuleType("google.auth")
    google_auth.impersonated_credentials = impersonated_credentials
    google_transport = ModuleType("google.auth.transport")
    google_transport.requests = transport_requests
    google_oauth2 = ModuleType("google.oauth2")
    google_oauth2.service_account = service_account

    with patch("app.services.gcp_impersonation.get_settings") as gs:
        settings = MagicMock()
        settings.VERITRAIL_GCP_PLATFORM_SA_EMAIL = _PLATFORM_SA["client_email"]
        settings.VERITRAIL_GCP_PLATFORM_SA_JSON = json.dumps(_PLATFORM_SA)
        settings.VERITRAIL_GCP_PLATFORM_SA_JSON_PATH = ""
        gs.return_value = settings
        with patch.dict(
            sys.modules,
            {
                "google": ModuleType("google"),
                "google.auth": google_auth,
                "google.auth.impersonated_credentials": impersonated_credentials,
                "google.auth.transport": google_transport,
                "google.auth.transport.requests": transport_requests,
                "google.oauth2": google_oauth2,
                "google.oauth2.service_account": service_account,
            },
        ):
            token = exchange_impersonation_access_token(
                service_account_email="scanner@customer.iam.gserviceaccount.com",
            )
    assert token == "impersonated-access-token"
    impersonated_credentials.Credentials.assert_called_once()
    call_kwargs = impersonated_credentials.Credentials.call_args.kwargs
    assert call_kwargs["target_principal"] == "scanner@customer.iam.gserviceaccount.com"


def test_gcp_client_from_impersonation_project():
    project = MagicMock()
    project.auth_method = AUTH_SERVICE_ACCOUNT_IMPERSONATION
    project.service_account_email = "scanner@customer.iam.gserviceaccount.com"

    with patch(
        "app.services.gcp_client.exchange_impersonation_access_token",
        return_value="tok",
    ):
        client = GcpClient.from_project(project)
        with patch.object(client, "_request", return_value={"projectId": "customer", "name": "Customer"}):
            out = client.verify("customer")
    assert out["project_id"] == "customer"


def test_gcp_client_rejects_unknown_auth_method():
    project = MagicMock()
    project.auth_method = "unknown"
    with pytest.raises(ValueError, match="Unsupported GCP auth_method"):
        GcpClient.from_project(project)
