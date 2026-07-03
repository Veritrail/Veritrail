"""IaC repository config helpers."""
from __future__ import annotations

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
