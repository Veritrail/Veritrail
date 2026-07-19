"""Phase 1 — GitLab pipeline heuristics + Vulnerability Report ingestion."""
from __future__ import annotations

from unittest.mock import MagicMock

from app.services.gitlab_security_evidence import (
    DEPENDENCY_CHECK_ID,
    collect_gitlab_security_evidence,
)


def _resp(status_code: int, json_data=None, *, headers=None, is_success: bool | None = None):
    r = MagicMock()
    r.status_code = status_code
    r.is_success = is_success if is_success is not None else 200 <= status_code < 300
    r.json.return_value = json_data if json_data is not None else []
    r.headers = headers or {}
    return r


def test_job_heuristics_plus_vulnerability_report_ingestion():
    client = MagicMock()

    def get(url, params=None):
        if url.endswith("/pipelines"):
            return _resp(200, [{"id": 10, "status": "success", "finished_at": "2026-07-18T00:00:00Z"}])
        if "/pipelines/10/jobs" in url:
            return _resp(
                200,
                [
                    {
                        "name": "dependency_scanning",
                        "status": "success",
                        "allow_failure": False,
                        "finished_at": "2026-07-18T00:05:00Z",
                    }
                ],
            )
        if url.endswith("/vulnerabilities"):
            return _resp(
                200,
                [
                    {
                        "id": 42,
                        "report_type": "dependency_scanning",
                        "severity": "high",
                        "state": "detected",
                        "title": "CVE in lodash",
                        "created_at": "2026-07-01T00:00:00Z",
                        "web_url": "https://gitlab.com/acme/api/-/security/vulnerabilities/42",
                        "identifiers": [{"external_type": "cve", "external_id": "CVE-2026-1"}],
                    }
                ],
            )
        return _resp(404)

    client.get.side_effect = get
    features, drafts, collected = collect_gitlab_security_evidence(
        client, "https://gitlab.com/api/v4", 7, "main", project_path="acme/api"
    )
    assert features["dependency_scanning"] is True
    dep = features["capability_evidence"]["dependency_scanning"]
    assert dep["open_findings"]["high"] == 1
    assert dep["alert_count"] == 1
    assert DEPENDENCY_CHECK_ID in collected
    assert any(d.check_id == DEPENDENCY_CHECK_ID for d in drafts)
    assert features["vulnerability_report"]["permission_status"] == "ok"


def test_vulnerability_api_denied_does_not_mark_checks_collected():
    client = MagicMock()

    def get(url, params=None):
        if url.endswith("/pipelines"):
            return _resp(200, [{"id": 1, "status": "success"}])
        if "/jobs" in url:
            return _resp(200, [{"name": "sast", "status": "success", "allow_failure": False}])
        if "/vulnerabilities" in url or "/vulnerability_findings" in url:
            return _resp(403)
        return _resp(404)

    client.get.side_effect = get
    features, drafts, collected = collect_gitlab_security_evidence(
        client, "https://gitlab.com/api/v4", 7, "main", project_path="acme/api"
    )
    assert drafts == []
    assert collected == set()
    assert "permission_denied" in (
        features["capability_evidence"]["source_code_scanning"].get("limitations") or []
    )
    assert features["vulnerability_report"]["limitation"] == "permission_denied"


def test_vulnerability_findings_paginate():
    client = MagicMock()
    page1 = [
        {
            "id": i,
            "report_type": "sast",
            "severity": "medium",
            "state": "detected",
            "title": f"Finding {i}",
        }
        for i in range(1, 101)
    ]
    page2 = [
        {
            "id": i,
            "report_type": "sast",
            "severity": "low",
            "state": "detected",
            "title": f"Finding {i}",
        }
        for i in range(101, 121)
    ]
    vuln_calls = {"n": 0}

    def get(url, params=None):
        if url.endswith("/pipelines"):
            return _resp(200, [])
        if url.endswith("/vulnerabilities"):
            vuln_calls["n"] += 1
            page = (params or {}).get("page", 1)
            if page == 1:
                return _resp(200, page1, headers={"X-Next-Page": "2"})
            return _resp(200, page2, headers={})
        return _resp(404)

    client.get.side_effect = get
    features, drafts, collected = collect_gitlab_security_evidence(
        client, "https://gitlab.com/api/v4", 7, None, project_path="acme/api"
    )
    sast_drafts = [d for d in drafts if d.check_id == "gitlab.sast.open_finding"]
    assert len(sast_drafts) == 120
    assert features["capability_evidence"]["source_code_scanning"]["alert_count"] == 120
    assert vuln_calls["n"] == 2
    assert "gitlab.sast.open_finding" in collected


def test_gitlab_false_resolution_skipped_when_vuln_api_denied():
    """Denied Vulnerability Report must not enter check_ids_run (no resolve-by-absence)."""
    client = MagicMock()

    def get(url, params=None):
        if url.endswith("/pipelines"):
            return _resp(200, [{"id": 1, "status": "success"}])
        if "/jobs" in url:
            return _resp(200, [])
        if "/vulnerabilities" in url or "/vulnerability_findings" in url:
            return _resp(403)
        return _resp(404)

    client.get.side_effect = get
    _features, drafts, collected = collect_gitlab_security_evidence(
        client, "https://gitlab.com/api/v4", 7, "main", project_path="acme/api"
    )
    assert drafts == []
    assert collected == set()
    assert DEPENDENCY_CHECK_ID not in collected
