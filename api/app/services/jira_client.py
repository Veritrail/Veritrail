"""Jira Cloud API client for ticketing integration."""
from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urlparse

import httpx

_SITE_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9\-]*\.atlassian\.net$")


def normalize_site_url(raw: str) -> str:
    value = raw.strip().rstrip("/")
    if not value:
        raise ValueError("Jira site URL is required")
    if not value.startswith("http"):
        value = f"https://{value}"
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("Jira site URL must be https://your-domain.atlassian.net")
    host = parsed.netloc.lower()
    if not (_SITE_RE.match(host) or host.endswith(".atlassian.net")):
        raise ValueError("Use your Jira Cloud site URL (https://your-domain.atlassian.net)")
    return f"https://{host}"


def _auth(email: str, api_token: str) -> tuple[str, str]:
    email = email.strip()
    token = api_token.strip()
    if not email or "@" not in email:
        raise ValueError("Jira account email is required")
    if not token:
        raise ValueError("Jira API token is required")
    return email, token


def _adf_from_text(text: str) -> dict[str, Any]:
    content: list[dict[str, Any]] = []
    for block in text.strip().split("\n\n"):
        paragraph_content: list[dict[str, Any]] = []
        for index, line in enumerate(block.splitlines()):
            if index:
                paragraph_content.append({"type": "hardBreak"})
            paragraph_content.append({"type": "text", "text": line})
        if paragraph_content:
            content.append({"type": "paragraph", "content": paragraph_content})
    return {
        "type": "doc",
        "version": 1,
        "content": content or [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
    }


class JiraClient:
    def __init__(self, *, site_url: str, email: str, api_token: str):
        self.site_url = normalize_site_url(site_url)
        self._auth = _auth(email, api_token)

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=f"{self.site_url}/rest/api/3",
            auth=self._auth,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            timeout=20,
        )

    def verify(self, project_key: str) -> dict[str, Any]:
        key = project_key.strip().upper()
        if not key:
            raise ValueError("Jira project key is required")
        with self._client() as client:
            me = client.get("/myself")
            me.raise_for_status()
            project = client.get(f"/project/{key}")
            project.raise_for_status()
            return {
                "account_id": me.json().get("accountId"),
                "display_name": me.json().get("displayName"),
                "project_key": project.json().get("key"),
                "project_name": project.json().get("name"),
            }

    def create_issue(
        self,
        *,
        project_key: str,
        summary: str,
        description: str,
        issue_type: str = "Task",
        labels: list[str] | None = None,
        priority: str | None = None,
        assignee_account_id: str | None = None,
    ) -> dict[str, str]:
        key = project_key.strip().upper()
        payload: dict[str, Any] = {
            "fields": {
                "project": {"key": key},
                "summary": summary[:255],
                "description": _adf_from_text(description),
                "issuetype": {"name": issue_type},
            }
        }
        if labels:
            payload["fields"]["labels"] = labels[:10]
        if priority:
            payload["fields"]["priority"] = {"name": priority}
        if assignee_account_id:
            payload["fields"]["assignee"] = {"accountId": assignee_account_id}

        with self._client() as client:
            resp = client.post("/issue", content=json.dumps(payload))
            if resp.status_code == 400:
                detail = resp.text
                raise ValueError(f"Jira rejected the issue: {detail[:400]}")
            resp.raise_for_status()
            data = resp.json()
            issue_key = data["key"]
            return {
                "issue_key": issue_key,
                "issue_url": f"{self.site_url}/browse/{issue_key}",
                "issue_id": data.get("id", ""),
            }

    def list_projects(self, *, max_results: int = 100) -> list[dict[str, str]]:
        projects: list[dict[str, str]] = []
        start_at = 0
        page_size = min(max_results, 50)
        with self._client() as client:
            while len(projects) < max_results:
                resp = client.get(
                    "/project/search",
                    params={"startAt": start_at, "maxResults": page_size, "orderBy": "name"},
                )
                resp.raise_for_status()
                data = resp.json()
                values = data.get("values") or []
                for project in values:
                    key = project.get("key", "")
                    if key:
                        projects.append(
                            {
                                "key": key,
                                "name": project.get("name", ""),
                                "id": project.get("id", ""),
                            }
                        )
                total = data.get("total", 0)
                start_at += len(values)
                if start_at >= total or not values:
                    break
        return projects[:max_results]

    def search_assignable_users(self, *, project_key: str, query: str = "") -> list[dict[str, str]]:
        key = project_key.strip().upper()
        with self._client() as client:
            resp = client.get(
                "/user/assignable/search",
                params={"project": key, "query": query.strip(), "maxResults": 15},
            )
            resp.raise_for_status()
            users = resp.json()
            return [
                {
                    "account_id": user.get("accountId", ""),
                    "display_name": user.get("displayName", ""),
                    "email": user.get("emailAddress", ""),
                    "avatar_url": (user.get("avatarUrls") or {}).get("48x48", ""),
                }
                for user in users
                if user.get("accountId") and user.get("displayName")
            ]
