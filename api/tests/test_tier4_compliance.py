"""Tier 4 compliance expansion tests."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock
from uuid import uuid4

import httpx

from app.services.composite_controls import composite_control_definitions
from app.services.gitlab_sync import _collect_security_features


def test_tier4_vulnerability_management_composite():
    by_id = {d["id"]: d for d in composite_control_definitions()}
    assert "vulnerability_management" in by_id
    vuln = by_id["vulnerability_management"]
    assert vuln["control_id"] == "COMPOSITE.VULNERABILITY_MANAGEMENT"
    assert "aws.vulnerability_monitoring.not_detected" in vuln["checks"]
    assert "aws.inspector.active_critical_finding" in vuln["checks"]
    assert "ec2.ami.aged" in vuln["checks"]
    assert "lambda.function.deprecated_runtime" in vuln["checks"]


def test_tier4_secure_sdlc_includes_gitlab_security_checks():
    by_id = {d["id"]: d for d in composite_control_definitions()}
    sdlc = by_id["secure_sdlc"]
    assert "gitlab.repo.sast_disabled" in sdlc["checks"]
    assert "gitlab.repo.dependency_scanning_disabled" in sdlc["checks"]
    assert "gitlab.repo.container_scanning_disabled" in sdlc["checks"]


def test_tier4_identity_governance_includes_identity_center_stale():
    by_id = {d["id"]: d for d in composite_control_definitions()}
    identity = by_id["identity_governance"]
    assert "identity_center.user.inactive_90d" in identity["checks"]


def test_gitlab_collect_security_features_detects_jobs():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/pipelines"):
            return httpx.Response(200, json=[{"id": 42}])
        if request.url.path.endswith("/jobs"):
            return httpx.Response(
                200,
                json=[
                    {"name": "semgrep-sast"},
                    {"name": "gemnasium-dependency_scanning"},
                    {"name": "container_scanning"},
                ],
            )
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport)
    features = _collect_security_features(client, "https://gitlab.com/api/v4", 1, "main")
    assert features == {
        "sast": True,
        "dependency_scanning": True,
        "container_scanning": True,
    }


def test_gitlab_collect_security_features_marks_missing_when_pipelines_exist():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/pipelines"):
            return httpx.Response(200, json=[{"id": 7}])
        if request.url.path.endswith("/jobs"):
            return httpx.Response(200, json=[{"name": "build"}, {"name": "test"}])
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport)
    features = _collect_security_features(client, "https://gitlab.com/api/v4", 1, "main")
    assert features == {
        "sast": False,
        "dependency_scanning": False,
        "container_scanning": False,
    }


def test_gitlab_sast_disabled_check_flags_repo(mock_db):
    from app.checks import gitlab_repo_sast_disabled

    provider = MagicMock()
    provider.id = uuid4()
    provider.type = "gitlab"
    provider.config_json_encrypted = '{"group_id":"acme"}'

    repo = MagicMock()
    repo.name = "acme/app"
    repo.security_features = {"sast": False, "dependency_scanning": True, "container_scanning": True}

    acc = MagicMock()
    acc.org_id = uuid4()
    mock_db.get.return_value = acc
    mock_db.scalars.return_value.all.side_effect = [[provider], [repo]]

    drafts = gitlab_repo_sast_disabled.run(mock_db, uuid4())
    assert len(drafts) == 1
    assert drafts[0].check_id == "gitlab.repo.sast_disabled"
    assert drafts[0].evidence["feature"] == "sast"


def test_identity_center_inactive_flags_stale_active_user(mock_db):
    from app.checks import identity_center_user_inactive

    cutoff = datetime.now(timezone.utc) - timedelta(days=120)
    user = MagicMock()
    user.identity_store_id = "d-abc"
    user.user_id = "u-1"
    user.user_name = "alice"
    user.display_name = "Alice"
    user.email = "alice@example.com"
    user.active = True
    user.external_created_at = cutoff
    user.external_updated_at = cutoff

    mock_db.scalars.return_value.all.return_value = [user]
    drafts = identity_center_user_inactive.run(mock_db, uuid4())

    assert len(drafts) == 1
    assert drafts[0].check_id == "identity_center.user.inactive_90d"
    assert "Alice" in drafts[0].title


def test_eks_control_plane_logging_disabled(mock_db):
    from app.checks import eks_control_plane_logging

    cluster = MagicMock()
    cluster.arn = "arn:aws:eks:us-east-1:123456789012:cluster/prod"
    cluster.name = "prod"
    cluster.region = "us-east-1"
    cluster.control_plane_logging_enabled = False
    mock_db.scalars.return_value.all.return_value = [cluster]

    drafts = eks_control_plane_logging.run(mock_db, uuid4())
    assert len(drafts) == 1
    assert drafts[0].check_id == "eks.cluster.control_plane_logging_disabled"


def test_eks_secrets_encryption_disabled(mock_db):
    from app.checks import eks_secrets_encryption

    cluster = MagicMock()
    cluster.arn = "arn:aws:eks:us-east-1:123456789012:cluster/prod"
    cluster.name = "prod"
    cluster.region = "us-east-1"
    cluster.version = "1.30"
    cluster.secrets_encryption_enabled = False
    mock_db.scalars.return_value.all.return_value = [cluster]

    drafts = eks_secrets_encryption.run(mock_db, uuid4())
    assert len(drafts) == 1
    assert drafts[0].check_id == "eks.cluster.secrets_encryption_disabled"
    assert drafts[0].severity == "high"
