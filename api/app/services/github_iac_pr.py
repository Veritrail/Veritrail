"""Create a GitHub PR with Terraform remediation (org GitHub integration token)."""
from __future__ import annotations

import base64
import re
import uuid
from typing import Any

import httpx

from app.models.github import IdentityProvider
from app.services.github_sync import GITHUB_API, provider_config

_BRANCH_SAFE = re.compile(r"[^a-zA-Z0-9._/-]+")


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def create_terraform_pr(
    provider: IdentityProvider,
    *,
    repo_full_name: str,
    title: str,
    body: str,
    terraform_hcl: str,
    file_path: str,
    base_branch: str | None = None,
) -> dict[str, Any]:
    """Open a PR on owner/repo with a single Terraform file change."""
    cfg = provider_config(provider)
    token = cfg.get("access_token")
    if not token:
        raise ValueError("GitHub integration has no access token — reconnect in Integrations")

    if "/" not in repo_full_name:
        raise ValueError("repo must be owner/name")
    owner, repo = repo_full_name.split("/", 1)

    branch = f"veritrail/remediation-{uuid.uuid4().hex[:8]}"
    safe_path = _BRANCH_SAFE.sub("-", file_path.lstrip("/")) or "veritrail-remediation.tf"

    with httpx.Client(headers=_headers(token), timeout=30) as client:
        repo_resp = client.get(f"{GITHUB_API}/repos/{owner}/{repo}")
        repo_resp.raise_for_status()
        base = base_branch or repo_resp.json().get("default_branch") or "main"

        ref_resp = client.get(f"{GITHUB_API}/repos/{owner}/{repo}/git/ref/heads/{base}")
        ref_resp.raise_for_status()
        base_sha = ref_resp.json()["object"]["sha"]

        create_ref = client.post(
            f"{GITHUB_API}/repos/{owner}/{repo}/git/refs",
            json={"ref": f"refs/heads/{branch}", "sha": base_sha},
        )
        create_ref.raise_for_status()

        content_b64 = base64.b64encode(terraform_hcl.encode()).decode()
        put_body: dict[str, Any] = {
            "message": title,
            "content": content_b64,
            "branch": branch,
        }
        existing = client.get(
            f"{GITHUB_API}/repos/{owner}/{repo}/contents/{safe_path}",
            params={"ref": branch},
        )
        if existing.status_code == 200:
            put_body["sha"] = existing.json().get("sha")

        put_resp = client.put(
            f"{GITHUB_API}/repos/{owner}/{repo}/contents/{safe_path}",
            json=put_body,
        )
        put_resp.raise_for_status()

        pr_resp = client.post(
            f"{GITHUB_API}/repos/{owner}/{repo}/pulls",
            json={
                "title": title,
                "head": branch,
                "base": base,
                "body": body,
            },
        )
        pr_resp.raise_for_status()
        pr = pr_resp.json()

    return {
        "status": "created",
        "pr_url": pr.get("html_url"),
        "pr_number": pr.get("number"),
        "branch": branch,
        "file_path": safe_path,
        "base_branch": base,
    }
