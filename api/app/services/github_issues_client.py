"""GitHub Issues client for remediation ticketing."""
from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

import httpx

GITHUB_API = "https://api.github.com"


def _strip_git_suffix(name: str) -> str:
    return name[:-4] if name.endswith(".git") else name


def _parse_github_repo_path(value: str) -> tuple[str, str]:
    if "://" in value:
        path = urlparse(value).path.strip("/")
    else:
        path = value.removeprefix("github.com/").strip("/")
    parts = [part for part in path.split("/") if part]
    if len(parts) >= 2:
        return parts[0], _strip_git_suffix(parts[1])
    if len(parts) == 1:
        return "", _strip_git_suffix(parts[0])
    return "", ""


def normalize_github_repo_ref(owner: str, repo: str) -> tuple[str, str]:
    """Accept owner+repo name, owner/repo, or a full GitHub URL."""
    owner = owner.strip().lstrip("/")
    repo = repo.strip().lstrip("/")

    for candidate in (repo, owner):
        if not candidate:
            continue
        if "://" in candidate or candidate.startswith("github.com/"):
            parsed_owner, parsed_repo = _parse_github_repo_path(candidate)
            if parsed_repo:
                return parsed_owner or owner, parsed_repo

    if "/" in repo and "://" not in repo:
        parts = [part for part in repo.split("/") if part]
        if len(parts) >= 2:
            return parts[0], _strip_git_suffix(parts[1])

    if "/" in owner and not repo:
        parts = [part for part in owner.split("/") if part]
        if len(parts) >= 2:
            return parts[0], _strip_git_suffix(parts[1])

    return owner, _strip_git_suffix(repo)


def _repo_access_error(status_code: int) -> str:
    if status_code == 404:
        return (
            "GitHub repository not found or not visible to your connected GitHub account. "
            "Pick an owner and repository you can access, or update GitHub permissions under Integrations → Source control."
        )
    if status_code in (401, 403):
        return (
            f"GitHub authentication failed or insufficient permissions ({status_code}). "
            "Reconnect GitHub under Integrations → Source control and ensure the repository is in scope."
        )
    return f"GitHub repo not accessible ({status_code})"


class GitHubIssuesClient:
    def __init__(self, *, token: str):
        token = token.strip()
        if not token:
            raise ValueError("GitHub token is required")
        self._token = token

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=GITHUB_API,
            headers={
                "Authorization": f"Bearer {self._token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            timeout=30.0,
        )

    def verify(self, owner: str, repo: str) -> dict[str, Any]:
        owner, repo = normalize_github_repo_ref(owner, repo)
        if not owner or not repo:
            raise ValueError("GitHub owner and repo are required")
        with self._client() as client:
            resp = client.get(f"/repos/{owner}/{repo}")
        if resp.status_code >= 400:
            raise ValueError(_repo_access_error(resp.status_code))
        data = resp.json()
        return {"owner": owner, "repo": repo, "full_name": data.get("full_name")}

    def create_issue(self, *, owner: str, repo: str, title: str, body: str, labels: list[str] | None = None) -> dict[str, str]:
        payload: dict[str, Any] = {"title": title, "body": body}
        if labels:
            payload["labels"] = labels
        with self._client() as client:
            resp = client.post(f"/repos/{owner}/{repo}/issues", json=payload)
        if resp.status_code >= 400:
            raise ValueError(f"GitHub issue create failed ({resp.status_code})")
        data = resp.json()
        return {
            "issue_key": str(data.get("number")),
            "issue_url": data.get("html_url") or "",
        }
