"""Create a GitLab Merge Request with Terraform remediation (org GitLab integration token)."""
from __future__ import annotations

import re
import uuid
from typing import Any
from urllib.parse import quote

import httpx

from app.models.github import IdentityProvider
from app.services.gitlab_sync import provider_config
from app.services.gitlab_tokens import ensure_gitlab_token

_BRANCH_SAFE = re.compile(r"[^a-zA-Z0-9._/-]+")


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def _api_base(provider: IdentityProvider) -> str:
    config = provider_config(provider)
    base = (config.get("base_url") or "https://gitlab.com").rstrip("/")
    return f"{base}/api/v4"


def create_terraform_mr(
    provider: IdentityProvider,
    db,
    *,
    repo_full_name: str,
    title: str,
    body: str,
    terraform_hcl: str,
    file_path: str,
    base_branch: str | None = None,
) -> dict[str, Any]:
    """Open a Merge Request on a GitLab project with a single Terraform file change.

    Uses the GitLab v4 REST API via httpx (no additional dependencies required).
    Creates branch, commits the HCL content, then opens an MR targeting the base branch.
    """
    token = ensure_gitlab_token(db, provider)
    api = _api_base(provider)

    project_path = quote(repo_full_name, safe="")
    branch = f"vigil/remediation-{uuid.uuid4().hex[:8]}"
    safe_path = _BRANCH_SAFE.sub("-", file_path.lstrip("/")) or "vigil-remediation.tf"

    with httpx.Client(headers=_headers(token), timeout=30) as client:
        # Get project metadata
        proj_resp = client.get(f"{api}/projects/{project_path}")
        proj_resp.raise_for_status()
        proj = proj_resp.json()
        project_id = proj["id"]
        base = base_branch or proj.get("default_branch") or "main"

        # 1. Create the branch from the base ref
        branch_resp = client.post(
            f"{api}/projects/{project_id}/repository/branches",
            params={"branch": branch, "ref": base},
        )
        branch_resp.raise_for_status()

        # 2. Check if file already exists on the branch to get the action right
        from urllib.parse import quote as file_quote

        file_path_encoded = file_quote(safe_path, safe="")
        existing = client.get(
            f"{api}/projects/{project_id}/repository/files/{file_path_encoded}",
            params={"ref": branch},
        )

        commit_action: dict[str, Any] = {
            "action": "update" if existing.status_code == 200 else "create",
            "file_path": safe_path,
            "content": terraform_hcl,
            "branch": branch,
        }

        # 3. Commit the file to the branch
        commit_resp = client.post(
            f"{api}/projects/{project_id}/repository/commits",
            json={
                "branch": branch,
                "commit_message": title,
                "actions": [commit_action],
            },
        )
        commit_resp.raise_for_status()

        # 4. Create the merge request
        mr_resp = client.post(
            f"{api}/projects/{project_id}/merge_requests",
            json={
                "title": title,
                "description": body,
                "source_branch": branch,
                "target_branch": base,
            },
        )
        mr_resp.raise_for_status()
        mr = mr_resp.json()

    return {
        "status": "created",
        "mr_url": mr.get("web_url"),
        "mr_iid": mr.get("iid"),
        "mr_id": mr.get("id"),
        "branch": branch,
        "file_path": safe_path,
        "base_branch": base,
    }
