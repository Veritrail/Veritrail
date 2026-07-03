"""Infer IaC repository layout using the hclpatch pipeline and repo file fetchers."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.services.github_repo_tf import fetch_terraform_files_with_token
from app.services.gitlab_repo_tf import fetch_gitlab_terraform_files_with_token
from app.services.hcl_patch import hcl_detect_layout
from app.services.iac_repository import (
    DEFAULT_TERRAFORM_PATH,
    github_owner_repo,
    normalize_repo_path,
    resolve_vcs_token,
)


def should_infer_iac_path(
    *,
    incoming_path: str | None,
    existing_path: str | None,
    incoming_repo_ref: str,
    existing_repo_ref: str,
) -> bool:
    """Return True when we should re-detect layout instead of keeping a stored path."""
    if incoming_path is not None and normalize_repo_path(incoming_path) != DEFAULT_TERRAFORM_PATH:
        return False
    if incoming_repo_ref.strip() != (existing_repo_ref or "").strip():
        return True
    if normalize_repo_path(existing_path) == DEFAULT_TERRAFORM_PATH:
        return True
    return False


def _repo_ref(link: dict[str, Any]) -> str:
    owner, repo = github_owner_repo(link)
    ref = (link.get("repo_ref") or "").strip()
    if ref:
        return ref
    if owner and repo:
        return f"{owner}/{repo}"
    return ""


def fetch_iac_repo_files(db: Session, org_id, link: dict[str, Any]) -> list[dict[str, str]]:
    """Fetch .tf/.hcl files for an IaC repo link (same sources as remediation scans)."""
    repo_ref = _repo_ref(link)
    if not repo_ref:
        raise ValueError("Repository reference is required")
    token = resolve_vcs_token(db, org_id, link)
    vcs = link.get("vcs_provider", "github")
    if vcs == "github":
        return fetch_terraform_files_with_token(token, repo_ref)
    if vcs == "gitlab":
        return fetch_gitlab_terraform_files_with_token(
            token,
            repo_ref,
            base_url=link.get("base_url"),
        )
    raise ValueError(f"Automatic IaC layout detection is not supported for {vcs}")


def infer_iac_layout(
    db: Session,
    org_id,
    link: dict[str, Any],
    *,
    uses_terragrunt: bool,
) -> dict[str, Any]:
    """Fetch repo IaC files and infer terraform/terragrunt paths via hclpatch."""
    files = fetch_iac_repo_files(db, org_id, link)
    layout = hcl_detect_layout(files, uses_terragrunt=uses_terragrunt)
    if layout.get("status") == "error":
        raise ValueError(layout.get("message") or "hclpatch layout detection failed")
    terraform_path = normalize_repo_path(layout.get("terraform_path"))
    terragrunt_path = normalize_repo_path(layout.get("terragrunt_path"), default=terraform_path)
    return {
        "terraform_path": terraform_path,
        "terragrunt_path": terragrunt_path,
        "paths_differ": bool(layout.get("paths_differ")),
        "files_analyzed": int(layout.get("files_analyzed") or len(files)),
        "status": layout.get("status") or "ok",
    }


def apply_inferred_path(
    db: Session,
    org_id,
    link: dict[str, Any],
    *,
    existing_link: dict[str, Any] | None,
    incoming_path: str | None,
    uses_terragrunt: bool,
) -> dict[str, Any] | None:
    """Set link path from hclpatch layout detection when appropriate."""
    incoming_repo_ref = _repo_ref(link)
    existing_repo_ref = _repo_ref(existing_link or {})
    existing_path = (existing_link or {}).get("path")
    if not should_infer_iac_path(
        incoming_path=incoming_path,
        existing_path=existing_path,
        incoming_repo_ref=incoming_repo_ref,
        existing_repo_ref=existing_repo_ref,
    ):
        return None
    try:
        layout = infer_iac_layout(db, org_id, link, uses_terragrunt=uses_terragrunt)
    except (ValueError, OSError):
        link["path"] = normalize_repo_path(incoming_path or existing_path)
        return None
    link["path"] = layout["terraform_path"]
    return layout
