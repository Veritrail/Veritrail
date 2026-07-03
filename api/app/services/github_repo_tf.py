"""Fetch Terraform files from a connected GitHub repo."""
from __future__ import annotations

import base64
from typing import Any

import httpx

from app.models.github import IdentityProvider
from app.services.github_sync import GITHUB_API, provider_config

_MAX_FILES = 40
_MAX_BYTES = 800_000


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def fetch_terraform_files(
    provider: IdentityProvider,
    repo_full_name: str,
    *,
    ref: str | None = None,
    max_files: int = _MAX_FILES,
) -> list[dict[str, str]]:
    """Return .tf / .hcl file paths + contents from repo default branch (or ref)."""
    cfg = provider_config(provider)
    token = cfg.get("access_token")
    if not token:
        raise ValueError("GitHub integration has no access token")
    return fetch_terraform_files_with_token(
        token,
        repo_full_name,
        ref=ref,
        max_files=max_files,
    )


def fetch_terraform_files_with_token(
    token: str,
    repo_full_name: str,
    *,
    ref: str | None = None,
    max_files: int = _MAX_FILES,
) -> list[dict[str, str]]:
    """Return .tf / .hcl file paths + contents using a bearer token."""

    if "/" not in repo_full_name:
        raise ValueError("repo must be owner/name")
    owner, repo = repo_full_name.split("/", 1)

    with httpx.Client(headers=_headers(token), timeout=45) as client:
        repo_resp = client.get(f"{GITHUB_API}/repos/{owner}/{repo}")
        repo_resp.raise_for_status()
        branch = ref or repo_resp.json().get("default_branch") or "main"

        tree_resp = client.get(
            f"{GITHUB_API}/repos/{owner}/{repo}/git/trees/{branch}",
            params={"recursive": "1"},
        )
        tree_resp.raise_for_status()
        tree = tree_resp.json().get("tree") or []

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
            sha = item.get("sha")
            if not sha:
                continue
            blob = client.get(f"{GITHUB_API}/repos/{owner}/{repo}/git/blobs/{sha}")
            if blob.status_code != 200:
                continue
            data = blob.json()
            if data.get("encoding") != "base64":
                continue
            raw = base64.b64decode(data["content"])
            if len(raw) > 200_000:
                continue
            total += len(raw)
            if total > _MAX_BYTES or len(out) >= max_files:
                break
            out.append({"path": path, "content": raw.decode("utf-8", errors="replace")})
        return out
