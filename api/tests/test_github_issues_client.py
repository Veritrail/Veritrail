"""GitHub Issues client helpers."""
from __future__ import annotations

from app.services.github_issues_client import normalize_github_repo_ref


def test_normalize_github_repo_ref_simple():
    assert normalize_github_repo_ref("awakzdev", "eks-production-iac") == (
        "awakzdev",
        "eks-production-iac",
    )


def test_normalize_github_repo_ref_full_url_with_git_suffix():
    assert normalize_github_repo_ref(
        "awakzdev",
        "https://github.com/awakzdev/eks-production-iac.git",
    ) == ("awakzdev", "eks-production-iac")


def test_normalize_github_repo_ref_owner_repo_shorthand():
    assert normalize_github_repo_ref("", "awakzdev/eks-production-iac") == (
        "awakzdev",
        "eks-production-iac",
    )


def test_normalize_github_repo_ref_url_only_in_repo_field():
    assert normalize_github_repo_ref(
        "",
        "https://github.com/awakzdev/eks-production-iac",
    ) == ("awakzdev", "eks-production-iac")
