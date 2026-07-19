"""Phase 1 — enabled-without-activity findings."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock

from app.checks._github_security_helpers import run_inactive_security_feature


def test_inactive_when_enabled_without_observable_activity(mock_db):
    account_id = uuid.uuid4()
    provider = MagicMock()
    provider.id = uuid.uuid4()
    provider.type = "github"
    repo = MagicMock()
    repo.id = uuid.uuid4()
    repo.name = "acme/api"
    repo.security_features = {
        "dependabot_alerts": True,
        "capability_evidence": {
            "dependency_scanning": {
                "enabled": True,
                "has_observable_activity": False,
                "permission_status": "ok",
                "limitations": ["enabled_without_observable_activity"],
            }
        },
    }

    # _providers_of_type path uses mock_db — patch via scalars chain used by helper.
    from app.checks import _github_security_helpers as helpers

    original = helpers._providers_of_type
    helpers._providers_of_type = lambda db, aid, ptype: [provider]
    helpers._source_label = lambda p: "github"
    try:
        repos_result = MagicMock()
        repos_result.all.return_value = [repo]
        mock_db.scalars.return_value = repos_result
        drafts = run_inactive_security_feature(
            mock_db, account_id, "dependabot_alerts", "github.repo.dependabot_inactive"
        )
        assert len(drafts) == 1
        assert drafts[0].check_id == "github.repo.dependabot_inactive"
        assert drafts[0].evidence["limitation"] == "enabled_without_observable_activity"
    finally:
        helpers._providers_of_type = original


def test_no_inactive_finding_when_activity_present(mock_db):
    account_id = uuid.uuid4()
    provider = MagicMock()
    provider.id = uuid.uuid4()
    repo = MagicMock()
    repo.id = uuid.uuid4()
    repo.name = "acme/api"
    repo.security_features = {
        "dependabot_alerts": True,
        "capability_evidence": {
            "dependency_scanning": {
                "enabled": True,
                "has_observable_activity": True,
                "permission_status": "ok",
            }
        },
    }
    from app.checks import _github_security_helpers as helpers

    original = helpers._providers_of_type
    helpers._providers_of_type = lambda db, aid, ptype: [provider]
    helpers._source_label = lambda p: "github"
    try:
        repos_result = MagicMock()
        repos_result.all.return_value = [repo]
        mock_db.scalars.return_value = repos_result
        drafts = run_inactive_security_feature(
            mock_db, account_id, "dependabot_alerts", "github.repo.dependabot_inactive"
        )
        assert drafts == []
    finally:
        helpers._providers_of_type = original
