"""Phase B — GitHub pagination budgets, Retry-After, and non-authoritative partials."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from app.services.github_security_evidence import (
    DEPENDABOT_CHECK_ID,
    collect_github_security_evidence,
    paginate_github_list,
)


def _resp(status_code: int, json_data=None, *, links=None, headers=None, text=""):
    r = MagicMock()
    r.status_code = status_code
    r.is_success = 200 <= status_code < 300
    r.json.return_value = json_data if json_data is not None else []
    r.links = links or {}
    r.headers = headers or {}
    r.text = text
    return r


def test_paginate_honors_retry_after_then_completes():
    client = MagicMock()
    calls = {"n": 0}

    def get(url, params=None):
        calls["n"] += 1
        if calls["n"] == 1:
            return _resp(429, [], headers={"Retry-After": "0"})
        return _resp(200, [{"number": 1}])

    client.get.side_effect = get
    with patch("app.services.github_security_evidence.time.sleep"):
        result = paginate_github_list(client, "https://api.github.com/x", max_retries=2)
    assert result.collection_status == "complete"
    assert result.retry_count == 1
    assert len(result.rows) == 1


def test_paginate_page_budget_marks_partial_not_authoritative():
    client = MagicMock()
    page = {"n": 0}

    def get(url, params=None):
        page["n"] += 1
        next_link = {"next": {"url": f"https://api.github.com/x?page={page['n'] + 1}"}}
        return _resp(200, [{"number": page["n"]}], links=next_link)

    client.get.side_effect = get
    result = paginate_github_list(
        client,
        "https://api.github.com/x",
        max_pages=2,
        max_requests=20,
        wall_clock_seconds=60,
    )
    assert result.collection_status == "partial"
    assert result.limited_by == "page_budget"
    assert result.pages_fetched == 2
    assert len(result.rows) == 2


def test_429_mid_pagination_does_not_resolve_or_refresh_evidence():
    """Simulated 429 after first page: not collected, no last_successful_scan_at."""
    client = MagicMock()
    calls = {"dep": 0}

    def get(url, params=None):
        if url.endswith("/vulnerability-alerts"):
            return _resp(204)
        if "/dependabot/alerts" in url:
            calls["dep"] += 1
            if calls["dep"] == 1:
                return _resp(
                    200,
                    [{"number": 1, "state": "open", "created_at": "2026-07-01T00:00:00Z",
                      "security_advisory": {"severity": "high", "summary": "x", "ghsa_id": "GHSA-x",
                                            "identifiers": []},
                      "dependency": {"package": {"name": "lodash", "ecosystem": "npm"},
                                     "manifest_path": "package-lock.json"},
                      "html_url": "https://github.com/acme/api/security/dependabot/1"}],
                    links={"next": {"url": "https://api.github.com/repos/acme/api/dependabot/alerts?page=2"}},
                )
            return _resp(429, [], headers={"Retry-After": "0"}, text="secondary rate limit")
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
    with patch("app.services.github_security_evidence.time.sleep"):
        features, _drafts, collected = collect_github_security_evidence(client, "acme", "api")

    dep = features["capability_evidence"]["dependency_scanning"]
    assert DEPENDABOT_CHECK_ID not in collected
    assert dep.get("last_successful_scan_at") is None
    assert dep["collection"]["collection_status"] == "partial"
    assert "collection_error" in dep["limitations"]


def test_secondary_rate_limit_stops_without_hammering_next_page():
    client = MagicMock()
    requests = []

    def get(url, params=None):
        requests.append(url)
        return _resp(
            403,
            [],
            headers={"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1"},
            text="You have exceeded a secondary rate limit",
        )

    client.get.side_effect = get
    with patch("app.services.github_security_evidence.time.sleep"):
        result = paginate_github_list(
            client,
            "https://api.github.com/x",
            max_retries=1,
            max_pages=10,
        )
    assert result.collection_status == "partial"
    assert result.limited_by == "rate_limit"
    # Initial attempt + 1 retry, then stop — never continues to invent more pages.
    assert len(requests) <= 2
