"""GCP Workload Identity Federation tests."""
from __future__ import annotations

import json
import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.services.gcp_client import GcpClient
from app.services.gcp_wif import (
    AUTH_WORKLOAD_IDENTITY,
    build_wif_audience,
    exchange_wif_access_token,
    generate_wif_subject,
    issue_subject_token,
    principal_member,
    setup_manifest,
)


def test_generate_wif_subject_unique():
    a = generate_wif_subject()
    b = generate_wif_subject()
    assert a and b and a != b


def test_build_wif_audience_format():
    aud = build_wif_audience("123456", "veritrail", "veritrail-oidc")
    assert aud == "//iam.googleapis.com/projects/123456/locations/global/workloadIdentityPools/veritrail/providers/veritrail-oidc"


def test_principal_member_format():
    member = principal_member("999", "pool", "subj-abc")
    assert member.endswith("/subject/subj-abc")
    assert "workloadIdentityPools/pool" in member


def test_issue_subject_token_has_required_claims():
    subject = "test-subject-xyz"
    token = issue_subject_token(subject)
    parts = token.split(".")
    assert len(parts) == 3


def test_setup_manifest_includes_issuer_and_subject():
    manifest = setup_manifest(project_id="demo-proj", wif_subject="subj-1", project_number="111")
    assert manifest["project_id"] == "demo-proj"
    assert manifest["wif_subject"] == "subj-1"
    assert manifest["issuer_uri"].endswith("/v1/integrations/gcp/wif")
    assert "principal_member" in manifest


def test_exchange_wif_access_token_mocked():
    import sys
    from types import ModuleType

    creds = MagicMock()
    creds.token = "gcp-access-token"
    creds.with_scopes.return_value = creds

    identity_pool = ModuleType("google.auth.identity_pool")
    identity_pool.Credentials = MagicMock(return_value=creds)
    transport_requests = ModuleType("google.auth.transport.requests")
    transport_requests.Request = MagicMock()

    google_auth = ModuleType("google.auth")
    google_auth.identity_pool = identity_pool
    google_transport = ModuleType("google.auth.transport")
    google_transport.requests = transport_requests

    with patch.dict(
        sys.modules,
        {
            "google": ModuleType("google"),
            "google.auth": google_auth,
            "google.auth.identity_pool": identity_pool,
            "google.auth.transport": google_transport,
            "google.auth.transport.requests": transport_requests,
        },
    ):
        token = exchange_wif_access_token(
            wif_subject="subj",
            audience="//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/p/providers/pr",
            service_account_email="sa@demo.iam.gserviceaccount.com",
        )
    assert token == "gcp-access-token"
    identity_pool.Credentials.assert_called_once()


def test_gcp_client_from_wif_project():
    project = MagicMock()
    project.auth_method = AUTH_WORKLOAD_IDENTITY
    project.wif_subject = "subj"
    project.service_account_email = "sa@demo.iam.gserviceaccount.com"
    project.project_number = "123"
    project.pool_id = "veritrail"
    project.provider_id = "veritrail-oidc"
    project.wif_audience = None
    project.project_id = "demo"

    with patch("app.services.gcp_client.exchange_wif_access_token", return_value="tok"):
        client = GcpClient.from_project(project)
        with patch.object(client, "_request", return_value={"projectId": "demo", "name": "Demo"}):
            out = client.verify("demo")
    assert out["project_id"] == "demo"


_SA = {
    "type": "service_account",
    "project_id": "demo-project",
    "client_email": "sa@demo-project.iam.gserviceaccount.com",
    "private_key": "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n",
}


def test_gcp_client_legacy_json_still_works():
    with patch.object(GcpClient, "_access_token", return_value="tok"):
        with patch("app.services.gcp_client.httpx.Client") as client_cls:
            client = MagicMock()
            client.__enter__.return_value = client
            client.__exit__.return_value = False
            client.request.return_value = MagicMock(
                status_code=200,
                content=b"{}",
                text="",
                json=lambda: {"projectId": "demo-project"},
            )
            client_cls.return_value = client
            out = GcpClient(json.dumps(_SA)).verify("demo-project")
    assert out["project_id"] == "demo-project"
