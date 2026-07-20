"""Phase 4 / Phase C — CrowdStrike / SentinelOne sync grading and contract fixtures."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.services.capability_limitations import limitation_impact
from app.services.edr_integrations import (
    OPTIONAL_VULN_MODULE_LIMITATIONS,
    crowdstrike_region_for_base_url,
    edr_type_for_vendor,
    envelopes_from_edr_config,
    sync_summary,
    validate_sentinelone_management_url,
    verify_edr_connection,
)
from app.services.technical_capability import apply_limitation_impacts


def test_edr_provider_types():
    assert edr_type_for_vendor("crowdstrike") == "edr_crowdstrike"
    assert edr_type_for_vendor("sentinelone") == "edr_sentinelone"


def test_crowdstrike_region_presets_resolve():
    assert crowdstrike_region_for_base_url("https://api.crowdstrike.com") == "us-1"
    assert crowdstrike_region_for_base_url("https://api.us-2.crowdstrike.com/") == "us-2"
    assert crowdstrike_region_for_base_url("https://api.eu-1.crowdstrike.com") == "eu-1"
    assert crowdstrike_region_for_base_url("https://api.custom.example") == "custom"


def test_validate_sentinelone_management_url_accepts_console():
    assert (
        validate_sentinelone_management_url("https://usea1.sentinelone.net/web/api")
        == "https://usea1.sentinelone.net"
    )


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "http://usea1.sentinelone.net",
        "https://localhost",
        "https://127.0.0.1",
        "https://user:pass@usea1.sentinelone.net",
    ],
)
def test_validate_sentinelone_management_url_rejects_invalid(raw: str):
    with pytest.raises(ValueError):
        validate_sentinelone_management_url(raw)


def test_crowdstrike_oauth_error_distinguishes_credentials_or_region():
    token_resp = MagicMock(status_code=401)
    token_resp.json.return_value = {}
    client = MagicMock()
    client.__enter__.return_value = client
    client.__exit__.return_value = False
    client.post.return_value = token_resp

    with patch("app.services.edr_integrations.httpx.Client", return_value=client):
        with pytest.raises(ValueError, match="credentials|cloud region"):
            verify_edr_connection(
                "crowdstrike",
                {
                    "client_id": "id",
                    "client_secret": "secret",
                    "base_url": "https://api.eu-1.crowdstrike.com",
                },
            )


def test_crowdstrike_hosts_scope_error_after_oauth():
    token_resp = MagicMock(status_code=200)
    token_resp.json.return_value = {"access_token": "t"}
    hosts_resp = MagicMock(status_code=403)
    client = MagicMock()
    client.__enter__.return_value = client
    client.__exit__.return_value = False
    client.post.return_value = token_resp
    client.get.return_value = hosts_resp

    with patch("app.services.edr_integrations.httpx.Client", return_value=client):
        with pytest.raises(ValueError, match="Hosts"):
            verify_edr_connection(
                "crowdstrike",
                {"client_id": "id", "client_secret": "secret"},
            )


def test_sentinelone_agents_permission_error_distinct_from_threats():
    agents_resp = MagicMock(status_code=403)
    client = MagicMock()
    client.__enter__.return_value = client
    client.__exit__.return_value = False
    client.get.return_value = agents_resp

    with patch("app.services.edr_integrations.httpx.Client", return_value=client):
        with pytest.raises(ValueError, match="Agents"):
            verify_edr_connection(
                "sentinelone",
                {"management_url": "https://usea1.sentinelone.net", "api_token": "tok"},
            )


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
    assert evidence[0]["coverage"]["eligible"] == 2
    assert evidence[0]["coverage"]["assessed"] == 2


def test_crowdstrike_device_offset_pagination_contract():
    """CrowdStrike Hosts queries use offset pagination across pages."""
    token_resp = MagicMock(status_code=200)
    token_resp.json.return_value = {"access_token": "t"}
    page1_ids = [f"h{i}" for i in range(100)]
    page2_ids = [f"h{i}" for i in range(100, 150)]
    query1 = MagicMock(status_code=200)
    query1.json.return_value = {
        "resources": page1_ids,
        "meta": {"pagination": {"total": 150, "offset": 0, "limit": 100}},
    }
    query2 = MagicMock(status_code=200)
    query2.json.return_value = {
        "resources": page2_ids,
        "meta": {"pagination": {"total": 150, "offset": 100, "limit": 100}},
    }
    detail1 = MagicMock(status_code=200)
    detail1.json.return_value = {
        "resources": [{"status": "normal", "last_seen": "2026-07-19T00:00:00Z"} for _ in range(50)]
    }
    detail2 = MagicMock(status_code=200)
    detail2.json.return_value = {
        "resources": [{"status": "normal", "last_seen": "2026-07-19T00:00:00Z"} for _ in range(50)]
    }
    detail3 = MagicMock(status_code=200)
    detail3.json.return_value = {
        "resources": [{"status": "normal", "last_seen": "2026-07-19T00:00:00Z"} for _ in range(50)]
    }
    vuln = MagicMock(status_code=404)

    client = MagicMock()
    client.__enter__.return_value = client
    client.__exit__.return_value = False
    client.post.return_value = token_resp
    client.get.side_effect = [query1, query2, detail1, detail2, detail3, vuln]

    with patch("app.services.edr_integrations.httpx.Client", return_value=client):
        summary = sync_summary(
            "crowdstrike",
            {"client_id": "id", "client_secret": "secret"},
        )

    assert summary["device_count"] == 150
    host_calls = [c for c in client.get.call_args_list if "/devices/queries/devices/v1" in str(c)]
    assert len(host_calls) == 2
    assert host_calls[0].kwargs["params"]["offset"] == 0
    assert host_calls[1].kwargs["params"]["offset"] == 100
    assert "spotlight_vulnerabilities_unavailable" in summary["capability_evidence"][0]["limitations"]


def test_crowdstrike_spotlight_after_pagination_contract():
    """Spotlight combined vulnerabilities use ``after`` cursor pagination."""
    token_resp = MagicMock(status_code=200)
    token_resp.json.return_value = {"access_token": "t"}
    query = MagicMock(status_code=200)
    query.json.return_value = {
        "resources": ["h1"],
        "meta": {"pagination": {"total": 1}},
    }
    detail = MagicMock(status_code=200)
    detail.json.return_value = {
        "resources": [{"status": "normal", "last_seen": "2026-07-19T00:00:00Z"}]
    }
    vuln1 = MagicMock(status_code=200)
    vuln1.json.return_value = {
        "resources": [{"severity": "HIGH"} for _ in range(100)],
        "meta": {"pagination": {"after": "cursor-a"}},
    }
    vuln2 = MagicMock(status_code=200)
    vuln2.json.return_value = {
        "resources": [{"severity": "LOW"} for _ in range(25)],
        "meta": {"pagination": {"after": ""}},
    }

    client = MagicMock()
    client.__enter__.return_value = client
    client.__exit__.return_value = False
    client.post.return_value = token_resp
    client.get.side_effect = [query, detail, vuln1, vuln2]

    with patch("app.services.edr_integrations.httpx.Client", return_value=client):
        summary = sync_summary(
            "crowdstrike",
            {"client_id": "id", "client_secret": "secret"},
        )

    assert summary["open_findings_count"] == 125
    spotlight_calls = [
        c for c in client.get.call_args_list if "/spotlight/combined/vulnerabilities/v1" in str(c)
    ]
    assert len(spotlight_calls) == 2
    assert "after" not in spotlight_calls[0].kwargs["params"]
    assert spotlight_calls[1].kwargs["params"]["after"] == "cursor-a"


def test_host_coverage_independent_of_optional_vuln_module():
    """Host/sensor coverage stays complete when Spotlight is not licensed."""
    token_resp = MagicMock(status_code=200)
    token_resp.json.return_value = {"access_token": "t"}
    query_resp = MagicMock(status_code=200)
    query_resp.json.return_value = {
        "resources": ["h1", "h2"],
        "meta": {"pagination": {"total": 2}},
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

    env = summary["capability_evidence"][0]
    assert env["coverage"]["eligible"] == 2
    assert env["coverage"]["assessed"] == 2
    assert env["enabled"] is True
    for code in env["limitations"]:
        if code in OPTIONAL_VULN_MODULE_LIMITATIONS or code.startswith("spotlight_query_error_"):
            assert limitation_impact(code) == "informational"
    assert (
        apply_limitation_impacts(
            "covered",
            env["limitations"],
            collection_status="complete",
        )
        == "covered"
    )


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


def test_sentinelone_agents_next_cursor_pagination_contract():
    agents1 = MagicMock(status_code=200)
    agents1.json.return_value = {
        "data": [{"isActive": True} for _ in range(100)],
        "pagination": {"nextCursor": "agt-cursor-1"},
    }
    agents2 = MagicMock(status_code=200)
    agents2.json.return_value = {
        "data": [{"isActive": True} for _ in range(20)],
        "pagination": {"nextCursor": ""},
    }
    threats = MagicMock(status_code=200)
    threats.json.return_value = {"data": [], "pagination": {}}
    apps = MagicMock(status_code=200)
    apps.json.return_value = {"data": []}

    client = MagicMock()
    client.__enter__.return_value = client
    client.__exit__.return_value = False
    client.get.side_effect = [agents1, agents2, threats, apps]

    with patch("app.services.edr_integrations.httpx.Client", return_value=client):
        summary = sync_summary(
            "sentinelone",
            {"management_url": "https://usea1.sentinelone.net", "api_token": "tok"},
        )

    assert summary["device_count"] == 120
    assert summary["healthy_device_count"] == 120
    agent_calls = [c for c in client.get.call_args_list if "agents" in str(c.args[0])]
    assert len(agent_calls) == 2
    assert "cursor" not in agent_calls[0].kwargs["params"]
    assert agent_calls[1].kwargs["params"]["cursor"] == "agt-cursor-1"


def test_sentinelone_threats_next_cursor_pagination_contract():
    agents = MagicMock(status_code=200)
    agents.json.return_value = {
        "data": [{"isActive": True}],
        "pagination": {},
    }
    threats1 = MagicMock(status_code=200)
    threats1.json.return_value = {
        "data": [{"confidenceLevel": "HIGH"} for _ in range(100)],
        "pagination": {"nextCursor": "thr-cursor-1"},
    }
    threats2 = MagicMock(status_code=200)
    threats2.json.return_value = {
        "data": [{"confidenceLevel": "LOW"} for _ in range(10)],
        "pagination": {"nextCursor": ""},
    }
    apps = MagicMock(status_code=403)

    client = MagicMock()
    client.__enter__.return_value = client
    client.__exit__.return_value = False
    client.get.side_effect = [agents, threats1, threats2, apps]

    with patch("app.services.edr_integrations.httpx.Client", return_value=client):
        summary = sync_summary(
            "sentinelone",
            {"management_url": "https://usea1.sentinelone.net", "api_token": "tok"},
        )

    assert summary["open_findings_count"] == 110
    assert "vulnerability_module_not_available" in summary["capability_evidence"][0]["limitations"]
    threat_calls = [c for c in client.get.call_args_list if "threats" in str(c.args[0])]
    assert len(threat_calls) == 2
    assert threat_calls[1].kwargs["params"]["cursor"] == "thr-cursor-1"


def test_sentinelone_agent_coverage_independent_of_threats_module():
    agents = MagicMock(status_code=200)
    agents.json.return_value = {
        "data": [{"isActive": True}, {"isActive": True}],
        "pagination": {},
    }
    threats = MagicMock(status_code=403)
    apps = MagicMock(status_code=404)

    client = MagicMock()
    client.__enter__.return_value = client
    client.__exit__.return_value = False
    client.get.side_effect = [agents, threats, apps]

    with patch("app.services.edr_integrations.httpx.Client", return_value=client):
        summary = sync_summary(
            "sentinelone",
            {"management_url": "https://usea1.sentinelone.net", "api_token": "tok"},
        )

    env = summary["capability_evidence"][0]
    assert env["coverage"]["eligible"] == 2
    assert env["coverage"]["assessed"] == 2
    assert "threats_api_forbidden" in env["limitations"]
    assert "vulnerability_module_not_available" in env["limitations"]
    assert limitation_impact("threats_api_forbidden") == "informational"
    assert (
        apply_limitation_impacts("covered", env["limitations"], collection_status="complete")
        == "covered"
    )
