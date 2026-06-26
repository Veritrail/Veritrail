"""Scanner integration service tests."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.services.scanner_integrations import sync_summary, verify_scanner_connection


def test_tenable_test_connection():
    with patch("app.services.scanner_integrations.httpx.Client") as client_cls:
        client = MagicMock()
        client.__enter__.return_value = client
        client.__exit__.return_value = False
        client.get.return_value = MagicMock(status_code=200, json=lambda: [])
        client_cls.return_value = client
        out = verify_scanner_connection("tenable", {"access_key": "a", "secret_key": "s"})
    assert out["ok"] is True


def test_wiz_sync_summary_count():
    cfg = {"api_url": "https://api.wiz.io", "client_id": "id", "client_secret": "sec"}
    with patch("app.services.scanner_integrations._wiz_open_findings", return_value=42):
        out = sync_summary("wiz", cfg)
    assert out["open_findings_count"] == 42
    assert out["last_synced_at"]


def test_unsupported_vendor_raises():
    with pytest.raises(ValueError, match="Unsupported"):
        verify_scanner_connection("unknown", {})
