"""Phase 4 — CrowdStrike / SentinelOne sync grading (mocked HTTP)."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from app.services.edr_integrations import (
    edr_type_for_vendor,
    envelopes_from_edr_config,
    sync_summary,
)


def test_edr_provider_types():
    assert edr_type_for_vendor("crowdstrike") == "edr_crowdstrike"
    assert edr_type_for_vendor("sentinelone") == "edr_sentinelone"


def test_crowdstrike_sync_builds_host_workload_envelope():
    token_resp = MagicMock(status_code=200)
    token_resp.json.return_value = {"access_token": "t"}
    query_resp = MagicMock(status_code=200)
    query_resp.json.return_value = {
        "resources": ["h1", "h2"],
        "meta": {"pagination": {}},
    }
    detail_resp = MagicMock(status_code=200)
    detail_resp.json.return_value = {
        "resources": [
            {"status": "normal", "last_seen": "2026-07-19T00:00:00Z"},
            {"status": "normal", "last_seen": "2026-07-19T00:00:00Z"},
        ]
    }
    vuln_resp = MagicMock(status_code=403)

    client = MagicMock()
    client.__enter__.return_value = client
    client.__exit__.return_value = False
    client.post.return_value = token_resp
    client.get.side_effect = [query_resp, detail_resp, vuln_resp]

    with patch("app.services.edr_integrations.httpx.Client", return_value=client):
        summary = sync_summary(
            "crowdstrike",
            {"client_id": "id", "client_secret": "secret"},
        )

    assert summary["device_count"] == 2
    assert summary["healthy_device_count"] == 2
    evidence = summary["capability_evidence"]
    assert evidence[0]["capability"] == "host_workload_scanning"
    assert evidence[0]["provider"] == "crowdstrike"
    assert "spotlight_vulnerabilities_not_licensed" in evidence[0]["limitations"]


def test_sentinelone_sync_empty_agents_not_covered():
    agents_resp = MagicMock(status_code=200)
    agents_resp.json.return_value = {"data": [], "pagination": {}}
    threats_resp = MagicMock(status_code=200)
    threats_resp.json.return_value = {"data": []}
    apps_resp = MagicMock(status_code=404)

    client = MagicMock()
    client.__enter__.return_value = client
    client.__exit__.return_value = False
    client.get.side_effect = [agents_resp, threats_resp, apps_resp]

    with patch("app.services.edr_integrations.httpx.Client", return_value=client):
        summary = sync_summary(
            "sentinelone",
            {"management_url": "https://usea1.sentinelone.net", "api_token": "tok"},
        )

    assert summary["device_count"] == 0
    env = envelopes_from_edr_config(summary)[0]
    assert env.capability == "host_workload_scanning"
    assert env.enabled is False
    assert "no_managed_agents" in env.limitations
