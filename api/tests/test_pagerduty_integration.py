from unittest.mock import MagicMock, patch

import pytest

from app.services.pagerduty_integration import sync_summary, verify_connection


def _response(status_code: int, payload: dict | None = None) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = payload or {}
    return response


def test_verify_connection_requires_a_token():
    with pytest.raises(ValueError, match="API access token"):
        verify_connection({})


def test_verify_connection_uses_pagerduty_token_authentication():
    client = MagicMock()
    client.get.return_value = _response(200, {"users": []})
    client_context = MagicMock()
    client_context.__enter__.return_value = client
    with patch("app.services.pagerduty_integration.httpx.Client", return_value=client_context):
        assert verify_connection({"api_token": "pd-token"}) == {"ok": True}
    _, kwargs = client.get.call_args
    assert kwargs["headers"]["Authorization"] == "Token token=pd-token"


def test_sync_summary_counts_services_and_open_incidents():
    client = MagicMock()
    client.get.side_effect = [
        _response(200, {"services": [{"id": "S1"}, {"id": "S2"}], "more": False}),
        _response(200, {"schedules": [{"id": "SCH1"}], "more": False}),
        _response(200, {"escalation_policies": [{"id": "E1"}], "more": False}),
        _response(200, {"incidents": [{"id": "I1"}], "more": False}),  # open
        _response(200, {"incidents": [], "more": False}),  # acknowledged
        _response(200, {"incidents": [{"id": "R1"}], "more": False}),  # resolved 7d
    ]
    client_context = MagicMock()
    client_context.__enter__.return_value = client
    with patch("app.services.pagerduty_integration.httpx.Client", return_value=client_context):
        summary = sync_summary({"api_token": "pd-token"})
    assert summary["service_count"] == 2
    assert summary["schedule_count"] == 1
    assert summary["open_incident_count"] == 1
    assert summary["last_synced_at"]
    assert summary["capability_evidence"][0]["capability"] == "incident_operations"
