"""Fetch Terraform files from a connected GitLab repo (GitLab API v4 via httpx)."""
from __future__ import annotations

from typing import Any

import httpx

from app.models.github import IdentityProvider
from app.services.gitlab_tokens import ensure_gitlab_token
from app.services.gitlab_sync import provider_config

_MAX_FILES = 40
_MAX_BYTES = 800_000


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _api_base_url(base_url: str | None) -> str:
    base = (base_url or "https://gitlab.com").rstrip("/")
    return f"{base}/api/v4"


def _api_base(provider: IdentityProvider) -> str:
    config = provider_config(provider)
    return _api_base_url(config.get("base_url"))


def fetch_terraform_files(
    provider: IdentityProvider,
    db,
    repo_full_name: str,
    *,
    ref: str | None = None,
    max_files: int = _MAX_FILES,
) -> list[dict[str, str]]:
    """Return .tf / .hcl file paths + contents from a GitLab project default branch (or ref).

    Uses the GitLab v4 REST API to list repository tree and fetch file contents.
    The repo_full_name should be URL-encoded project path, e.g. "group/subgroup/project".
    """
    token = ensure_gitlab_token(db, provider)
    config = provider_config(provider)
    return fetch_gitlab_terraform_files_with_token(
        token,
        repo_full_name,
        base_url=config.get("base_url"),
        ref=ref,
        max_files=max_files,
    )


def fetch_gitlab_terraform_files_with_token(
    token: str,
    repo_full_name: str,
    *,
    base_url: str | None = None,
    ref: str | None = None,
    max_files: int = _MAX_FILES,
) -> list[dict[str, str]]:
    """Return .tf / .hcl file paths + contents using a bearer token."""
    api = _api_base_url(base_url)

    # GitLab v4 API requires project path to be URL-encoded
    from urllib.parse import quote

    project_path = quote(repo_full_name, safe="")

    with httpx.Client(headers=_headers(token), timeout=45) as client:
        # Get project metadata for default branch
        proj_resp = client.get(f"{api}/projects/{project_path}")
        proj_resp.raise_for_status()
        proj = proj_resp.json()
        project_id = proj["id"]
        branch = ref or proj.get("default_branch") or "main"

        # List repository tree recursively
        tree: list[dict[str, Any]] = []
        page = 1
        while True:
            tree_resp = client.get(
                f"{api}/projects/{project_id}/repository/tree",
                params={
                    "ref": branch,
                    "recursive": "true",
                    "per_page": 100,
                    "page": page,
                },
            )
            if tree_resp.status_code != 200:
                break
            page_data = tree_resp.json()
            if not isinstance(page_data, list) or not page_data:
                break
            tree.extend(page_data)
            # Check for next page
            next_page = tree_resp.headers.get("X-Next-Page", "")
            if not next_page:
                break
            page = int(next_page)

        out: list[dict[str, str]] = []
        total = 0
        for item in tree:
            if item.get("type") != "blob":
                continue
            path = item.get("path") or ""
            if not (path.endswith(".tf") or path.endswith(".hcl")):
                continue
            if "/.terraform/" in path or path.startswith("."):
                continue

            # Fetch file content via repository files API
            from urllib.parse import quote as file_quote

            file_path_encoded = file_quote(path, safe="")
            file_resp = client.get(
                f"{api}/projects/{project_id}/repository/files/{file_path_encoded}",
                params={"ref": branch},
            )
            if file_resp.status_code != 200:
                continue

            file_data = file_resp.json()
            encoding = file_data.get("encoding", "base64")
            if encoding == "base64":
                import base64

                raw = base64.b64decode(file_data["content"])
            else:
                raw = file_data.get("content", "").encode("utf-8")

            if len(raw) > 200_000:
                continue
            total += len(raw)
            if total > _MAX_BYTES or len(out) >= max_files:
                break
            out.append({"path": path, "content": raw.decode("utf-8", errors="replace")})

        return out
