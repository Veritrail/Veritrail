"""GitHub Issues client for remediation ticketing."""
from __future__ import annotations

from typing import Any

import httpx

GITHUB_API = "https://api.github.com"


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
        owner = owner.strip().lstrip("/")
        repo = repo.strip().lstrip("/")
        if not owner or not repo:
            raise ValueError("GitHub owner and repo are required")
        with self._client() as client:
            resp = client.get(f"/repos/{owner}/{repo}")
        if resp.status_code >= 400:
            raise ValueError(f"GitHub repo not accessible ({resp.status_code})")
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
