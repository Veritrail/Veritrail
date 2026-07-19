"""Phase 1 — GitHub Dependabot / CodeQL / secret-scanning evidence collection."""
from __future__ import annotations

from unittest.mock import MagicMock

from app.services.github_security_evidence import (
    ALERT_CHECK_IDS,
    CODE_SCANNING_CHECK_ID,
    DEPENDABOT_CHECK_ID,
    SECRET_SCANNING_CHECK_ID,
    collect_github_security_evidence,
)


def _resp(status_code: int, json_data=None, *, is_success: bool | None = None, links=None):
    r = MagicMock()
    r.status_code = status_code
    r.is_success = is_success if is_success is not None else 200 <= status_code < 300
    r.json.return_value = json_data if json_data is not None else []
    r.links = links or {}
    return r


def _baseline_ok_handlers():
    """Shared stubs for code/secret/actions endpoints used by most tests."""

    def get(url, params=None):
        if url.endswith("/vulnerability-alerts"):
            return _resp(204)
        if "/dependabot/alerts" in url:
            return _resp(200, [])
        if "/code-scanning/analyses" in url:
            return _resp(200, [{"created_at": "2026-07-18T00:00:00Z"}])
        if "/code-scanning/alerts" in url:
            return _resp(200, [])
        if "/secret-scanning/alerts" in url:
            return _resp(200, [])
        if "/actions/runs" in url:
            return _resp(200, {"workflow_runs": []})
        return _resp(404)

    return get


def test_dependabot_enabled_with_alert_list_is_observable():
    client = MagicMock()

    def get(url, params=None):
        if url.endswith("/vulnerability-alerts"):
            return _resp(204)
        if "/dependabot/alerts" in url:
            return _resp(
                200,
                [
                    {
                        "number": 1,
                        "state": "open",
                        "created_at": "2026-07-01T00:00:00Z",
                        "security_advisory": {
                            "severity": "high",
                            "summary": "Test advisory",
                            "ghsa_id": "GHSA-test",
                            "identifiers": [{"type": "CVE", "value": "CVE-2026-0001"}],
                        },
                        "dependency": {
                            "package": {"name": "lodash", "ecosystem": "npm"},
                            "manifest_path": "package-lock.json",
                        },
                        "html_url": "https://github.com/acme/api/security/dependabot/1",
                    }
                ],
            )
        if "/code-scanning/analyses" in url:
            return _resp(200, [{"created_at": "2026-07-18T00:00:00Z"}])
        if "/code-scanning/alerts" in url:
            return _resp(200, [])
        if "/secret-scanning/alerts" in url:
            return _resp(200, [])
        if "/actions/runs" in url:
            return _resp(
                200,
                {
                    "workflow_runs": [
                        {
                            "name": "CodeQL",
                            "path": ".github/workflows/codeql.yml",
                            "conclusion": "success",
                            "updated_at": "2026-07-18T12:00:00Z",
                        }
                    ]
                },
            )
        return _resp(404)

    client.get.side_effect = get
    features, drafts, collected = collect_github_security_evidence(client, "acme", "api")
    assert features["dependabot_alerts"] is True
    dep = features["capability_evidence"]["dependency_scanning"]
    assert dep["enabled"] is True
    assert dep["has_observable_activity"] is True
    assert dep["open_findings"]["high"] == 1
    assert any(d.check_id == "github.dependabot.open_alert" for d in drafts)
    assert features["actions_evidence"]["security_job_success"] is True
    assert DEPENDABOT_CHECK_ID in collected
    assert CODE_SCANNING_CHECK_ID in collected
    assert SECRET_SCANNING_CHECK_ID in collected


def test_dependabot_enabled_but_alerts_unavailable_is_not_fully_covered_signal():
    client = MagicMock()

    def get(url, params=None):
        if url.endswith("/vulnerability-alerts"):
            return _resp(204)
        if "/dependabot/alerts" in url:
            return _resp(404)
        if "/code-scanning/" in url:
            return _resp(404)
        if "/secret-scanning/" in url:
            return _resp(404)
        if "/actions/runs" in url:
            return _resp(200, {"workflow_runs": []})
        return _resp(404)

    client.get.side_effect = get
    features, drafts, collected = collect_github_security_evidence(client, "acme", "api")
    dep = features["capability_evidence"]["dependency_scanning"]
    assert dep["enabled"] is True
    assert dep["has_observable_activity"] is False
    assert "unavailable_by_plan" in dep["limitations"]
    assert drafts == []
    # Unavailable-by-plan must NOT mark dependabot collected (no resolve-by-absence).
    assert DEPENDABOT_CHECK_ID not in collected


def test_permission_denied_does_not_mark_alert_checks_collected():
    client = MagicMock()

    def get(url, params=None):
        if url.endswith("/vulnerability-alerts"):
            return _resp(204)
        if "/dependabot/alerts" in url:
            return _resp(403)
        if "/code-scanning/" in url:
            return _resp(403)
        if "/secret-scanning/" in url:
            return _resp(403)
        if "/actions/runs" in url:
            return _resp(403)
        return _resp(404)

    client.get.side_effect = get
    features, drafts, collected = collect_github_security_evidence(client, "acme", "api")
    assert drafts == []
    assert collected == set()
    assert features["capability_evidence"]["dependency_scanning"]["permission_status"] == "denied"
    assert features["capability_evidence"]["source_code_scanning"]["permission_status"] == "denied"
    assert features["capability_evidence"]["secret_scanning"]["permission_status"] == "denied"


def test_dependabot_alerts_paginate_beyond_fifty():
    """Regression: must not stop at 50 alerts (page size was previously capped)."""
    client = MagicMock()
    page1 = [
        {
            "number": i,
            "state": "open",
            "created_at": "2026-07-01T00:00:00Z",
            "security_advisory": {"severity": "medium", "summary": f"Alert {i}"},
            "dependency": {"package": {"name": f"pkg-{i}", "ecosystem": "npm"}},
            "html_url": f"https://github.com/acme/api/security/dependabot/{i}",
        }
        for i in range(1, 101)
    ]
    page2 = [
        {
            "number": i,
            "state": "open",
            "created_at": "2026-07-01T00:00:00Z",
            "security_advisory": {"severity": "low", "summary": f"Alert {i}"},
            "dependency": {"package": {"name": f"pkg-{i}", "ecosystem": "npm"}},
            "html_url": f"https://github.com/acme/api/security/dependabot/{i}",
        }
        for i in range(101, 151)
    ]
    calls = {"dependabot": 0}

    def get(url, params=None):
        if url.endswith("/vulnerability-alerts"):
            return _resp(204)
        if "/dependabot/alerts" in url or url.endswith("/dependabot/alerts?state=open&per_page=100&page=2"):
            calls["dependabot"] += 1
            if calls["dependabot"] == 1:
                return _resp(
                    200,
                    page1,
                    links={"next": {"url": "https://api.github.com/repos/acme/api/dependabot/alerts?state=open&per_page=100&page=2"}},
                )
            return _resp(200, page2)
        if "/code-scanning/analyses" in url:
            return _resp(200, [])
        if "/code-scanning/alerts" in url:
            return _resp(200, [])
        if "/secret-scanning/alerts" in url:
            return _resp(200, [])
        if "/actions/runs" in url:
            return _resp(200, {"workflow_runs": []})
        return _resp(404)

    client.get.side_effect = get
    features, drafts, collected = collect_github_security_evidence(client, "acme", "api")
    dep_drafts = [d for d in drafts if d.check_id == DEPENDABOT_CHECK_ID]
    assert len(dep_drafts) == 150
    assert features["capability_evidence"]["dependency_scanning"]["alert_count"] == 150
    assert DEPENDABOT_CHECK_ID in collected
    assert calls["dependabot"] == 2


def test_false_resolution_skipped_when_alerts_api_denied():
    """CRITICAL: permission-denied collection must not enter check_ids_run.

    ``persist_org_findings`` auto-resolves open findings for every id in
    ``check_ids_run`` that is absent from drafts. Denied collection must yield
    an empty intersection so prior alerts stay open.
    """
    client = MagicMock()
    client.get.side_effect = lambda url, params=None: (
        _resp(204)
        if url.endswith("/vulnerability-alerts")
        else _resp(403)
        if "/dependabot/alerts" in url
        or "/code-scanning/" in url
        or "/secret-scanning/" in url
        or "/actions/runs" in url
        else _resp(404)
    )
    _features, drafts, collected = collect_github_security_evidence(client, "acme", "api")
    assert drafts == []
    assert collected == set()
    # Sync intersects per-repo collected sets before persist.
    check_ids_run = set(ALERT_CHECK_IDS) & collected
    assert check_ids_run == set()
    assert DEPENDABOT_CHECK_ID not in check_ids_run


def test_successful_collection_includes_checks_for_resolve():
    """Authoritative empty inventory may be passed as check_ids_run (normal reconcile)."""
    client = MagicMock()
    client.get.side_effect = _baseline_ok_handlers()
    _features, drafts, collected = collect_github_security_evidence(client, "acme", "api")
    assert drafts == []
    assert DEPENDABOT_CHECK_ID in collected
    assert CODE_SCANNING_CHECK_ID in collected
    assert SECRET_SCANNING_CHECK_ID in collected


def test_multi_repo_intersection_drops_denied_check():
    """One denied repo must remove that check from the sync-wide check_ids_run."""
    ok_client = MagicMock()
    ok_client.get.side_effect = _baseline_ok_handlers()
    _f1, _d1, collected_ok = collect_github_security_evidence(ok_client, "acme", "ok")

    denied = MagicMock()

    def denied_get(url, params=None):
        if url.endswith("/vulnerability-alerts"):
            return _resp(204)
        if "/dependabot/alerts" in url:
            return _resp(403)
        if "/code-scanning/analyses" in url:
            return _resp(200, [{"created_at": "2026-07-18T00:00:00Z"}])
        if "/code-scanning/alerts" in url:
            return _resp(200, [])
        if "/secret-scanning/alerts" in url:
            return _resp(200, [])
        if "/actions/runs" in url:
            return _resp(200, {"workflow_runs": []})
        return _resp(404)

    denied.get.side_effect = denied_get
    _f2, _d2, collected_denied = collect_github_security_evidence(denied, "acme", "denied")

    check_ids_run = collected_ok & collected_denied
    assert DEPENDABOT_CHECK_ID not in check_ids_run
    assert DEPENDABOT_CHECK_ID in collected_ok
    assert DEPENDABOT_CHECK_ID not in collected_denied
    # Other successfully collected checks may still reconcile.
    assert SECRET_SCANNING_CHECK_ID in check_ids_run
