import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from app.services.sdlc_evidence import build_sdlc_evidence


def test_sdlc_evidence_repo_security_gaps(mock_db):
    org_id = uuid.uuid4()
    provider = MagicMock()
    provider.id = uuid.uuid4()
    repo = MagicMock()
    repo.id = uuid.uuid4()
    repo.name = "acme/api"
    repo.default_branch = "main"
    repo.security_features = {"dependabot_alerts": False, "code_scanning": True}

    providers_result = MagicMock()
    providers_result.all.return_value = [provider]
    repos_result = MagicMock()
    repos_result.all.return_value = [repo]
    tickets_result = MagicMock()
    tickets_result.all.return_value = []

    mock_db.scalars.side_effect = [providers_result, repos_result, tickets_result]
    mock_db.scalar.side_effect = [0, 0, None]

    since = datetime.now(timezone.utc) - timedelta(days=30)
    data = build_sdlc_evidence(mock_db, org_id, since)
    assert data["repos_total"] == 1
    assert data["repos_without_branch_protection"] == ["acme/api"]
    assert data["dependabot_enabled_repos"] == 0
    assert data["code_scanning_enabled_repos"] == 1
    assert "no_branch_protection" in data["repo_details"][0]["gaps"]
