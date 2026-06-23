import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.services.remediation_plan import validate_plan_expiry, build_remediation_plan


# ---------------------------------------------------------------------------
# GitLab IaC PR — fetch_terraform_files
# ---------------------------------------------------------------------------

@patch("app.services.gitlab_repo_tf.ensure_gitlab_token", return_value="fake-token")
def test_fetch_gitlab_tf_empty_repo(mock_token):
    """fetch_terraform_files returns empty list when tree has no .tf/.hcl blobs."""
    from app.services.gitlab_repo_tf import fetch_terraform_files

    provider = MagicMock()
    provider_config = MagicMock(return_value={"base_url": "https://gitlab.example.com"})
    with patch("app.services.gitlab_repo_tf.provider_config", provider_config):
        db = MagicMock()

        mock_proj = {"id": 42, "default_branch": "main"}
        mock_tree = [
            {"type": "blob", "path": "README.md"},
            {"type": "tree", "path": "src"},
        ]

        with patch("httpx.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value.__enter__.return_value = mock_client

            def _mock_get(*args, **kwargs):
                resp = MagicMock()
                resp.status_code = 200
                url = args[0] if args else kwargs.get("url", "")
                if "repository/tree" in url:
                    resp.json.return_value = mock_tree
                    resp.headers = {}
                else:
                    resp.json.return_value = mock_proj
                return resp

            mock_client.get.side_effect = _mock_get

            result = fetch_terraform_files(provider, db, "my-group/my-project")
            assert result == []


@patch("app.services.gitlab_repo_tf.ensure_gitlab_token", return_value="fake-token")
def test_fetch_gitlab_tf_finds_tf_files(mock_token):
    """fetch_terraform_files returns .tf files found in the repository tree."""
    from app.services.gitlab_repo_tf import fetch_terraform_files

    provider = MagicMock()
    provider_config = MagicMock(return_value={"base_url": "https://gitlab.example.com"})
    with patch("app.services.gitlab_repo_tf.provider_config", provider_config):
        db = MagicMock()

        mock_proj = {"id": 42, "default_branch": "main"}
        mock_tree = [
            {"type": "blob", "path": "main.tf"},
            {"type": "blob", "path": "variables.tf"},
            {"type": "blob", "path": "README.md"},
        ]
        main_tf_content = {
            "encoding": "base64",
            "content": "cmVzb3VyY2UgInJlZ2lvbiIgewogIG5hbWUgPSAidXMtZWFzdC0xIgp9",
        }
        vars_tf_content = {
            "encoding": "base64",
            "content": "dmFyaWFibGUgImVuYWJsZWQiIHsgZGVmYXVsdCA9IHRydWUgfQ==",
        }

        with patch("httpx.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value.__enter__.return_value = mock_client

            def _mock_get(*args, **kwargs):
                resp = MagicMock()
                resp.status_code = 200
                url = args[0] if args else kwargs.get("url", "")
                if "repository/tree" in url:
                    resp.json.return_value = mock_tree
                    resp.headers = {}
                elif "repository/files" in url:
                    if "main.tf" in url:
                        resp.json.return_value = main_tf_content
                    elif "variables.tf" in url:
                        resp.json.return_value = vars_tf_content
                    else:
                        resp.json.return_value = {}
                else:
                    resp.json.return_value = mock_proj
                return resp

            mock_client.get.side_effect = _mock_get

            result = fetch_terraform_files(provider, db, "my-group/my-project")
            assert len(result) == 2
            assert result[0]["path"] == "main.tf"
            assert "resource" in result[0]["content"]


@patch("app.services.gitlab_repo_tf.ensure_gitlab_token", return_value="fake-token")
def test_fetch_gitlab_tf_skips_dot_terraform(mock_token):
    """fetch_terraform_files skips files in .terraform directories."""
    from app.services.gitlab_repo_tf import fetch_terraform_files

    provider = MagicMock()
    provider_config = MagicMock(return_value={})
    with patch("app.services.gitlab_repo_tf.provider_config", provider_config):
        db = MagicMock()

        mock_proj = {"id": 42, "default_branch": "main"}
        mock_tree = [
            {"type": "blob", "path": ".terraform/modules/foo/main.tf"},
            {"type": "blob", "path": "modules/foo/main.tf"},
        ]
        modules_tf_content = {
            "encoding": "base64",
            "content": "bW9kdWxlICJmb28iIHsKICBzb3VyY2UgPSAiLi9mb28iCn0=",
        }

        with patch("httpx.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value.__enter__.return_value = mock_client

            def _mock_get(*args, **kwargs):
                resp = MagicMock()
                resp.status_code = 200
                url = args[0] if args else kwargs.get("url", "")
                if "repository/tree" in url:
                    resp.json.return_value = mock_tree
                    resp.headers = {}
                elif "repository/files" in url:
                    resp.json.return_value = modules_tf_content
                else:
                    resp.json.return_value = mock_proj
                return resp

            mock_client.get.side_effect = _mock_get

            result = fetch_terraform_files(provider, db, "my-group/my-project")
            assert len(result) == 1
            assert result[0]["path"] == "modules/foo/main.tf"


# ---------------------------------------------------------------------------
# GitLab IaC PR — create_terraform_mr
# ---------------------------------------------------------------------------

@patch("app.services.gitlab_iac_pr.ensure_gitlab_token", return_value="fake-token")
def test_create_gitlab_mr_opens_successfully(mock_token):
    """create_terraform_mr creates branch, commits HCL, and opens merge request."""
    from app.services.gitlab_iac_pr import create_terraform_mr

    provider = MagicMock()
    provider_config = MagicMock(return_value={"base_url": "https://gitlab.example.com"})
    with patch("app.services.gitlab_iac_pr.provider_config", provider_config):
        db = MagicMock()

        mock_proj = {"id": 42, "default_branch": "main"}
        mock_branch = {"name": "veritrail/remediation-abc123"}
        mock_commit = {"id": "abc123commit"}
        mock_mr = {
            "iid": 1,
            "id": 100,
            "web_url": "https://gitlab.example.com/group/proj/-/merge_requests/1",
        }

        with patch("httpx.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value.__enter__.return_value = mock_client

            # Response for project GET
            proj_resp = MagicMock()
            proj_resp.raise_for_status = MagicMock()
            proj_resp.json.return_value = mock_proj

            # Response for file-exists check GET
            file_check_resp = MagicMock()
            file_check_resp.status_code = 404

            mock_client.get.side_effect = [proj_resp, file_check_resp]

            # Responses for POST calls: branch, commit, MR
            branch_resp = MagicMock()
            branch_resp.raise_for_status = MagicMock()
            branch_resp.json.return_value = mock_branch

            commit_resp = MagicMock()
            commit_resp.raise_for_status = MagicMock()
            commit_resp.json.return_value = mock_commit

            mr_resp = MagicMock()
            mr_resp.raise_for_status = MagicMock()
            mr_resp.json.return_value = mock_mr

            mock_client.post.side_effect = [branch_resp, commit_resp, mr_resp]

            result = create_terraform_mr(
                provider,
                db,
                repo_full_name="group/subgroup/project",
                title="Veritrail: remediate s3.bucket.public_access_not_blocked",
                body="Automated remediation",
                terraform_hcl='resource "aws_s3_bucket" "main" {}',
                file_path="terraform/main.tf",
                base_branch="main",
            )

            assert result["status"] == "created"
            assert result["mr_iid"] == 1
            assert result["mr_id"] == 100
            assert result["mr_url"] == "https://gitlab.example.com/group/proj/-/merge_requests/1"
            assert result["branch"].startswith("veritrail/remediation-")
            assert result["file_path"] == "terraform/main.tf"
            assert result["base_branch"] == "main"


@patch("app.services.gitlab_iac_pr.ensure_gitlab_token", return_value="fake-token")
def test_create_gitlab_mr_sanitizes_file_path(mock_token):
    """create_terraform_mr sanitizes dangerous characters from file paths."""
    from app.services.gitlab_iac_pr import create_terraform_mr

    provider = MagicMock()
    provider_config = MagicMock(return_value={})
    with patch("app.services.gitlab_iac_pr.provider_config", provider_config):
        db = MagicMock()

        mock_proj = {"id": 42, "default_branch": "main"}
        mock_branch = {"name": "veritrail/remediation-def456"}
        mock_commit = {"id": "def456commit"}
        mock_mr = {
            "iid": 2,
            "id": 200,
            "web_url": "https://gitlab.example.com/group/proj/-/merge_requests/2",
        }

        with patch("httpx.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value.__enter__.return_value = mock_client

            proj_resp = MagicMock()
            proj_resp.raise_for_status = MagicMock()
            proj_resp.json.return_value = mock_proj

            file_check_resp = MagicMock()
            file_check_resp.status_code = 404

            mock_client.get.side_effect = [proj_resp, file_check_resp]

            branch_resp = MagicMock()
            branch_resp.raise_for_status = MagicMock()
            branch_resp.json.return_value = mock_branch

            commit_resp = MagicMock()
            commit_resp.raise_for_status = MagicMock()
            commit_resp.json.return_value = mock_commit

            mr_resp = MagicMock()
            mr_resp.raise_for_status = MagicMock()
            mr_resp.json.return_value = mock_mr

            mock_client.post.side_effect = [branch_resp, commit_resp, mr_resp]

            result = create_terraform_mr(
                provider,
                db,
                repo_full_name="group/project",
                title="Test",
                body="Test",
                terraform_hcl="resource {}",
                file_path="/some/path/<<unsafe>>.tf",
            )

            # Should not contain < or >
            assert "<" not in result["file_path"]
            assert ">" not in result["file_path"]


@patch("app.services.gitlab_iac_pr.ensure_gitlab_token", return_value="fake-token")
def test_create_gitlab_mr_applies_default_file_path(mock_token):
    """create_terraform_mr uses veritrail-remediation.tf when path is empty."""
    from app.services.gitlab_iac_pr import create_terraform_mr

    provider = MagicMock()
    provider_config = MagicMock(return_value={})
    with patch("app.services.gitlab_iac_pr.provider_config", provider_config):
        db = MagicMock()

        mock_proj = {"id": 42, "default_branch": "main"}
        mock_branch = {"name": "veritrail/remediation-xyz789"}
        mock_commit = {"id": "xyz789commit"}
        mock_mr = {
            "iid": 3,
            "id": 300,
            "web_url": "https://gitlab.example.com/group/proj/-/merge_requests/3",
        }

        with patch("httpx.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value.__enter__.return_value = mock_client

            proj_resp = MagicMock()
            proj_resp.raise_for_status = MagicMock()
            proj_resp.json.return_value = mock_proj

            file_check_resp = MagicMock()
            file_check_resp.status_code = 404

            mock_client.get.side_effect = [proj_resp, file_check_resp]

            branch_resp = MagicMock()
            branch_resp.raise_for_status = MagicMock()
            branch_resp.json.return_value = mock_branch

            commit_resp = MagicMock()
            commit_resp.raise_for_status = MagicMock()
            commit_resp.json.return_value = mock_commit

            mr_resp = MagicMock()
            mr_resp.raise_for_status = MagicMock()
            mr_resp.json.return_value = mock_mr

            mock_client.post.side_effect = [branch_resp, commit_resp, mr_resp]

            result = create_terraform_mr(
                provider,
                db,
                repo_full_name="group/project",
                title="Test",
                body="Test",
                terraform_hcl="resource {}",
                file_path="/",
            )

            assert result["file_path"] == "veritrail-remediation.tf"


# ---------------------------------------------------------------------------
# Remediation plan expiry
# ---------------------------------------------------------------------------

def test_validate_plan_expiry_accepts_valid_plan():
    """validate_plan_expiry returns True for a freshly created plan."""
    plan = {
        "plan_id": "test-123",
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat(),
    }
    assert validate_plan_expiry(plan) is True


def test_validate_plan_expiry_rejects_expired_plan():
    """validate_plan_expiry returns False for an expired plan."""
    plan = {
        "plan_id": "test-456",
        "expires_at": (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(),
    }
    assert validate_plan_expiry(plan) is False


def test_validate_plan_expiry_allows_missing_expiry():
    """validate_plan_expiry returns True for pre-TTL plans without expires_at."""
    plan = {"plan_id": "test-789"}
    assert validate_plan_expiry(plan) is True


def test_validate_plan_expiry_allows_malformed_expiry():
    """validate_plan_expiry returns True for plans with unparseable expires_at."""
    plan = {"plan_id": "test-000", "expires_at": "not-a-date"}
    assert validate_plan_expiry(plan) is True


def test_build_remediation_plan_includes_expires_in_minutes():
    """build_remediation_plan includes expires_in_minutes field."""
    from app.models import Finding

    now = datetime.now(timezone.utc)
    finding = Finding(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        account_id=uuid.uuid4(),
        check_id="s3.bucket.public_access_not_blocked",
        resource_arn="arn:aws:s3:::my-bucket",
        title="S3 bucket public access not blocked",
        severity="high",
        risk_score=80,
        status="open",
        evidence={"bucket_name": "my-bucket"},
        first_seen=now,
        last_seen=now,
    )

    plan = build_remediation_plan(finding)
    assert "expires_in_minutes" in plan
    assert isinstance(plan["expires_in_minutes"], int)
    assert plan["expires_in_minutes"] >= 5


def test_dispatch_rejects_expired_plan():
    """build_remediation_dispatch raises ValueError for an expired plan."""
    from unittest.mock import patch, MagicMock

    from app.models import Finding

    now = datetime.now(timezone.utc)
    finding = Finding(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        account_id=uuid.uuid4(),
        check_id="ec2.security_group.unrestricted_ssh",
        resource_arn="arn:aws:ec2:us-east-1:123456789012:security-group/sg-abc",
        title="SSH open to world",
        severity="high",
        risk_score=80,
        status="open",
        evidence={"group_id": "sg-abc", "region": "us-east-1", "exposing_rules": []},
        first_seen=now,
        last_seen=now,
    )

    expired = (now - timedelta(minutes=5)).isoformat()
    expired_plan = {
        "plan_id": "expired-plan",
        "schema": "veritrail_remediation_plan/v2",
        "created_at": (now - timedelta(hours=1)).isoformat(),
        "expires_at": expired,
        "expires_in_minutes": 60,
    }

    with patch(
        "app.services.remediation_dispatch.build_approved_remediation_plan",
        return_value=expired_plan,
    ):
        with pytest.raises(ValueError, match="Remediation plan has expired"):
            from app.services.remediation_dispatch import build_remediation_dispatch
            build_remediation_dispatch(finding, approved_by="test-user")
