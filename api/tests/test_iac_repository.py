"""IaC repository config helpers."""
from __future__ import annotations

import pytest

from app.services.iac_repository import (
    build_remediation_ticket_body,
    normalize_iac_config,
    normalize_repo_path,
    remediation_paths,
    ticket_target_repo,
)


def test_normalize_repo_path_defaults():
    assert normalize_repo_path(None) == "."
    assert normalize_repo_path("") == "."
    assert normalize_repo_path("terraform/") == "terraform"


def test_terragrunt_path_optional():
    cfg = normalize_iac_config({"owner": "o", "repo": "r", "terraform_path": "modules"})
    assert cfg["terraform_path"] == "modules"
    assert cfg["terragrunt_path"] is None
    paths = remediation_paths(cfg)
    assert paths["pr_path"] == "modules"
    assert not paths["paths_differ"]


def test_different_terraform_and_terragrunt_paths():
    cfg = normalize_iac_config(
        {
            "owner": "awakzdev",
            "repo": "eks-production-iac",
            "terraform_path": "modules",
            "terragrunt_path": "environments/prod/us-east-1",
            "uses_terragrunt": True,
            "repo_mode": "single",
        }
    )
    paths = remediation_paths(cfg)
    assert paths["terraform_path"] == "modules"
    assert paths["terragrunt_path"] == "environments/prod/us-east-1"
    assert paths["pr_path"] == "environments/prod/us-east-1"
    assert paths["paths_differ"]


def test_legacy_github_issues_shape_migrates():
    cfg = normalize_iac_config({"owner": "awakzdev", "repo": "eks-production-iac", "labels": ["security"]})
    assert cfg["vcs_provider"] == "github"
    assert cfg["repo_ref"] == "awakzdev/eks-production-iac"
    assert cfg["terraform_repo"]["repo_ref"] == "awakzdev/eks-production-iac"
    assert cfg["labels"] == ["security"]
    assert cfg["repo_mode"] == "single"
    assert not cfg["uses_terragrunt"]


def test_dual_repo_mode():
    cfg = normalize_iac_config(
        {
            "uses_terragrunt": True,
            "repo_mode": "dual",
            "terraform_repo": {
                "vcs_provider": "github",
                "owner": "awakzdev",
                "repo": "tf-modules",
                "repo_ref": "awakzdev/tf-modules",
                "path": ".",
            },
            "terragrunt_repo": {
                "vcs_provider": "github",
                "owner": "awakzdev",
                "repo": "eks-production-iac",
                "repo_ref": "awakzdev/eks-production-iac",
                "path": "environments/prod",
            },
        }
    )
    paths = remediation_paths(cfg)
    assert paths["repo_mode"] == "dual"
    assert ticket_target_repo(cfg)["repo_ref"] == "awakzdev/eks-production-iac"


def test_github_app_repository_metadata_is_preserved():
    cfg = normalize_iac_config(
        {
            "terraform_repo": {
                "vcs_provider": "github",
                "owner": "awakzdev",
                "repo": "terraform-live",
                "repo_ref": "awakzdev/terraform-live",
                "auth_method": "github_app",
                "installation_id": "12345",
                "installation_account": "awakzdev",
                "repository_id": "98765",
            }
        }
    )

    repo = cfg["terraform_repo"]
    assert repo["auth_method"] == "github_app"
    assert repo["installation_id"] == "12345"
    assert repo["installation_account"] == "awakzdev"
    assert repo["repository_id"] == "98765"


def test_oauth_auth_method_is_preserved():
    cfg = normalize_iac_config(
        {
            "terraform_repo": {
                "vcs_provider": "github",
                "owner": "awakzdev",
                "repo": "terraform-live",
                "repo_ref": "awakzdev/terraform-live",
                "auth_method": "oauth",
            }
        }
    )

    repo = cfg["terraform_repo"]
    assert repo["auth_method"] == "oauth"
    assert repo["installation_id"] == ""
    assert repo["repository_id"] == ""


def test_prepare_github_repo_link_prefers_oauth(monkeypatch):
    from app.routes.iac_repository_integration import _prepare_github_repo_link

    link = {"owner": "awakzdev", "repo": "iac", "repo_ref": "awakzdev/iac"}
    github_app = {"installation_id": "999", "account_login": "awakzdev"}

    monkeypatch.setattr(
        "app.routes.iac_repository_integration._github_oauth_status",
        lambda db, org_id: (True, "user"),
    )

    _prepare_github_repo_link(None, None, link, github_app)  # type: ignore[arg-type]
    assert link["auth_method"] == "oauth"
    assert link["repository_id"] == ""


def test_prepare_github_repo_link_uses_app_when_explicit(monkeypatch):
    from app.routes.iac_repository_integration import _prepare_github_repo_link

    link = {
        "owner": "awakzdev",
        "repo": "iac",
        "repo_ref": "awakzdev/iac",
        "auth_method": "github_app",
        "repository_id": "123",
        "installation_id": "456",
    }
    github_app = {"installation_id": "456", "account_login": "awakzdev"}

    monkeypatch.setattr(
        "app.routes.iac_repository_integration._github_oauth_status",
        lambda db, org_id: (True, "user"),
    )

    _prepare_github_repo_link(None, None, link, github_app)  # type: ignore[arg-type]
    assert link["auth_method"] == "github_app"
    assert link["repository_id"] == "123"


def test_remediation_ticket_body_includes_both_paths():
    body = build_remediation_ticket_body(
        finding_title="S3 bucket public",
        severity="high",
        check_id="s3.bucket.public",
        resource_arn="arn:aws:s3:::demo",
        finding_url="https://app/findings?finding=1",
        cfg={
            "uses_terragrunt": True,
            "repo_mode": "single",
            "terraform_repo": {"repo_ref": "org/iac", "path": "modules"},
            "terragrunt_path": "environments/prod",
        },
    )
    assert "Terraform modules: `org/iac` @ `modules`" in body
    assert "Terragrunt live stacks" in body
    assert "Suggested PR target: `environments/prod`" in body


def test_should_infer_iac_path_preserves_custom_path():
    from app.services.iac_path_infer import should_infer_iac_path

    assert not should_infer_iac_path(
        incoming_path="modules",
        existing_path="modules",
        incoming_repo_ref="org/iac",
        existing_repo_ref="org/iac",
    )


def test_should_infer_iac_path_when_repo_changes():
    from app.services.iac_path_infer import should_infer_iac_path

    assert should_infer_iac_path(
        incoming_path=None,
        existing_path="modules",
        incoming_repo_ref="org/new-iac",
        existing_repo_ref="org/iac",
    )


def test_should_infer_iac_path_for_new_default_path():
    from app.services.iac_path_infer import should_infer_iac_path

    assert should_infer_iac_path(
        incoming_path=None,
        existing_path=None,
        incoming_repo_ref="org/iac",
        existing_repo_ref="",
    )


def test_parse_azure_devops_repo_link_full_ref():
    from app.services.iac_repository import parse_azure_devops_repo_link

    org_url, project, repo = parse_azure_devops_repo_link(
        {"repo_ref": "myorg/MyProject/my-repo"}
    )
    assert org_url == "https://dev.azure.com/myorg"
    assert project == "MyProject"
    assert repo == "my-repo"


def test_parse_azure_devops_repo_link_with_base_url():
    from app.services.iac_repository import parse_azure_devops_repo_link

    org_url, project, repo = parse_azure_devops_repo_link(
        {
            "base_url": "https://dev.azure.com/myorg",
            "repo_ref": "MyProject/my-repo",
        }
    )
    assert org_url == "https://dev.azure.com/myorg"
    assert project == "MyProject"
    assert repo == "my-repo"


def test_verify_azure_devops_repo_success(monkeypatch):
    from app.services.iac_repository import verify_azure_devops_repo

    class FakeResponse:
        status_code = 200

        def json(self):
            return {"name": "my-repo"}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url):
            assert "/_apis/git/repositories/my-repo" in url
            return FakeResponse()

    monkeypatch.setattr("app.services.iac_repository.httpx.Client", FakeClient)
    verify_azure_devops_repo(
        {
            "repo_ref": "myorg/MyProject/my-repo",
            "access_token": "pat-token",
        }
    )


def test_verify_azure_devops_repo_rejects_bad_credentials(monkeypatch):
    from app.services.iac_repository import verify_azure_devops_repo

    class FakeResponse:
        status_code = 401

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url):
            return FakeResponse()

    monkeypatch.setattr("app.services.iac_repository.httpx.Client", FakeClient)
    with pytest.raises(ValueError, match="authentication failed"):
        verify_azure_devops_repo(
            {
                "repo_ref": "myorg/MyProject/my-repo",
                "access_token": "bad",
            }
        )


def test_verify_codecommit_repo_via_git_https(monkeypatch):
    from app.services.iac_repository import verify_codecommit_repo

    class FakeResponse:
        status_code = 200

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url, headers=None):
            assert "git-codecommit.us-west-2.amazonaws.com/v1/repos/demo-repo" in url
            assert headers["Authorization"].startswith("Basic ")
            return FakeResponse()

    monkeypatch.setattr("app.services.iac_repository.httpx.Client", FakeClient)
    verify_codecommit_repo(
        {
            "repo_ref": "demo-repo",
            "base_url": "us-west-2",
            "access_token": "git-user:git-pass",
        }
    )


def test_verify_codecommit_repo_rejects_missing_repo():
    from app.services.iac_repository import verify_codecommit_repo

    with pytest.raises(ValueError, match="repository name is required"):
        verify_codecommit_repo({"access_token": "user:pass"})


def test_verify_repo_link_azure_devops(monkeypatch):
    from app.routes.iac_repository_integration import _verify_repo_link

    called = {"azure": False}

    def fake_verify(link):
        called["azure"] = True
        assert link["vcs_provider"] == "azure_devops"

    monkeypatch.setattr(
        "app.routes.iac_repository_integration.verify_azure_devops_repo",
        fake_verify,
    )
    _verify_repo_link(
        None,
        None,
        {"vcs_provider": "azure_devops", "repo_ref": "org/proj/repo", "access_token": "pat"},
    )
    assert called["azure"]


def test_verify_repo_link_codecommit(monkeypatch):
    from app.routes.iac_repository_integration import _verify_repo_link

    called = {"codecommit": False}

    def fake_verify(link):
        called["codecommit"] = True
        assert link["vcs_provider"] == "codecommit"

    monkeypatch.setattr(
        "app.routes.iac_repository_integration.verify_codecommit_repo",
        fake_verify,
    )
    _verify_repo_link(
        None,
        None,
        {"vcs_provider": "codecommit", "repo_ref": "demo", "access_token": "u:p"},
    )
    assert called["codecommit"]
