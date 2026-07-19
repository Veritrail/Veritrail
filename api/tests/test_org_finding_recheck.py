"""Org-scoped Verify fix for GitHub/GitLab findings."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

from app.services.org_finding_recheck import try_org_finding_recheck


def _github_finding(*, status="open", source="awakzdev"):
    finding = MagicMock()
    finding.id = uuid.uuid4()
    finding.org_id = uuid.uuid4()
    finding.account_id = None
    finding.check_id = "github.repo.dependabot_disabled"
    finding.resource_arn = f"github://{source}/awakzdev/some-repo"
    finding.evidence = {"repo": "awakzdev/some-repo", "source": source, "feature": "dependabot_alerts"}
    finding.status = status
    return finding


def _provider():
    provider = MagicMock()
    provider.id = uuid.uuid4()
    provider.type = "github"
    provider.org_id = uuid.uuid4()
    provider.config_json_encrypted = '{"org_login":"awakzdev","access_token":"tok"}'
    return provider


@patch("app.services.org_finding_recheck.sync_github_provider")
@patch("app.services.org_finding_recheck._matching_providers")
def test_org_recheck_resolves_when_sync_closes_finding(mock_match, mock_sync):
    finding = _github_finding()
    provider = _provider()
    mock_match.return_value = [provider]

    refreshed = MagicMock()
    refreshed.status = "resolved"

    db = MagicMock()
    db.get.return_value = refreshed

    out = try_org_finding_recheck(db, finding=finding, actor="tester@example.com")

    assert out is not None
    assert out["checked"] is True
    assert out["resolved"] is True
    mock_sync.assert_called_once_with(db, provider)


@patch("app.services.org_finding_recheck.sync_github_provider")
@patch("app.services.org_finding_recheck._matching_providers")
def test_org_recheck_unchanged_when_still_failing(mock_match, mock_sync):
    finding = _github_finding()
    mock_match.return_value = [_provider()]

    refreshed = MagicMock()
    refreshed.status = "open"
    db = MagicMock()
    db.get.return_value = refreshed

    out = try_org_finding_recheck(db, finding=finding, actor="tester@example.com")

    assert out is not None
    assert out["checked"] is True
    assert out["resolved"] is False
    assert out["reason"] == "resource_still_failing"
    mock_sync.assert_called_once()


def test_org_recheck_returns_none_for_aws_finding():
    finding = _github_finding()
    finding.account_id = uuid.uuid4()
    finding.check_id = "iam.user.no_mfa"
    out = try_org_finding_recheck(MagicMock(), finding=finding, actor="x")
    assert out is None


@patch("app.services.org_finding_recheck._matching_providers", return_value=[])
def test_org_recheck_without_provider_returns_error(_mock_match):
    finding = _github_finding()
    out = try_org_finding_recheck(MagicMock(), finding=finding, actor="x")

    assert out is not None
    assert out["checked"] is True
    assert out["resolved"] is False
    assert out["error"]


@patch("app.services.org_finding_recheck.sync_github_provider", side_effect=RuntimeError("token expired"))
@patch("app.services.org_finding_recheck._matching_providers")
def test_org_recheck_sync_failure_returns_error(mock_match, _mock_sync):
    finding = _github_finding()
    mock_match.return_value = [_provider()]
    db = MagicMock()

    out = try_org_finding_recheck(db, finding=finding, actor="x")

    assert out is not None
    assert out["checked"] is True
    assert out["resolved"] is False
    assert "token expired" in out["error"]
    db.rollback.assert_called_once()
