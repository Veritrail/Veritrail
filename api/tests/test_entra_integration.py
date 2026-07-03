"""Microsoft Entra ID integration route tests."""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.core.security import current_principal
from app.routes import entra_integration


def test_connect_url_requires_oauth_config(monkeypatch):
    monkeypatch.setattr(entra_integration.settings, "ENTRA_CLIENT_ID", "")
    principal = {"sub": str(uuid.uuid4()), "org_id": str(uuid.uuid4())}
    with pytest.raises(HTTPException) as exc:
        entra_integration._connect_url(principal)
    assert exc.value.status_code == 400
    assert exc.value.detail == "Microsoft Entra OAuth not configured"


def test_connect_url_returns_authorize_url(monkeypatch):
    monkeypatch.setattr(entra_integration.settings, "ENTRA_CLIENT_ID", "entra-test-client-id")
    monkeypatch.setattr(entra_integration.settings, "API_PUBLIC_URL", "http://localhost:8000")
    monkeypatch.setattr(
        entra_integration.settings,
        "ENTRA_INTEGRATION_CALLBACK_PATH",
        "/v1/integrations/entra/callback",
    )
    principal = {"sub": str(uuid.uuid4()), "org_id": str(uuid.uuid4())}
    url = entra_integration._connect_url(principal)
    assert url.startswith("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?")
    assert "client_id=entra-test-client-id" in url
    assert "redirect_uri=" in url
    assert "state=" in url
