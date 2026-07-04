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

    def verify(self, project_key: str | None = None) -> dict[str, Any]:
        with self._client() as client:
            me = client.get("/myself")
            me.raise_for_status()
            result: dict[str, Any] = {
                "account_id": me.json().get("accountId"),
                "display_name": me.json().get("displayName"),
            }
            key = (project_key or "").strip().upper()
            if key:
                project = client.get(f"/project/{key}")
                project.raise_for_status()
                result["project_key"] = project.json().get("key")
                result["project_name"] = project.json().get("name")
            return result

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
            mapped = [
                {
                    "account_id": user.get("accountId", ""),
                    "display_name": user.get("displayName", ""),
                    "email": user.get("emailAddress", ""),
                    "avatar_url": (user.get("avatarUrls") or {}).get("48x48", ""),
                }
                for user in users
                if user.get("accountId") and user.get("displayName")
            ]
            return dedupe_assignable_users(mapped)


def _assignable_user_rank(user: dict[str, str]) -> tuple[int, int]:
    return (1 if user.get("email") else 0, 1 if user.get("avatar_url") else 0)


def dedupe_assignable_users(users: list[dict[str, str]]) -> list[dict[str, str]]:
    """Collapse duplicate Jira user rows returned by assignable search."""
    by_account: dict[str, dict[str, str]] = {}
    account_order: list[str] = []
    for user in users:
        account_id = user["account_id"]
        existing = by_account.get(account_id)
        if existing is None:
            by_account[account_id] = user
            account_order.append(account_id)
        elif _assignable_user_rank(user) > _assignable_user_rank(existing):
            by_account[account_id] = user

    unique_by_account = [by_account[account_id] for account_id in account_order]

    name_groups: dict[str, list[dict[str, str]]] = {}
    for user in unique_by_account:
        name_key = user["display_name"].casefold().strip()
        name_groups.setdefault(name_key, []).append(user)

    kept_account_ids: set[str] = set()
    for group in name_groups.values():
        if len(group) == 1:
            kept_account_ids.add(group[0]["account_id"])
            continue

        with_email = [user for user in group if user.get("email")]
        without_email = [user for user in group if not user.get("email")]

        if with_email and without_email:
            # Jira often returns the same person twice: one row omits emailAddress.
            by_email: dict[str, dict[str, str]] = {}
            for user in with_email:
                email_key = user["email"].casefold()
                existing = by_email.get(email_key)
                if existing is None or _assignable_user_rank(user) > _assignable_user_rank(existing):
                    by_email[email_key] = user
            kept_account_ids.update(user["account_id"] for user in by_email.values())
            continue

        if with_email:
            by_email = {}
            for user in with_email:
                email_key = user["email"].casefold()
                existing = by_email.get(email_key)
                if existing is None or _assignable_user_rank(user) > _assignable_user_rank(existing):
                    by_email[email_key] = user
            kept_account_ids.update(user["account_id"] for user in by_email.values())
            continue

        best = max(group, key=_assignable_user_rank)
        kept_account_ids.add(best["account_id"])

    return [user for user in unique_by_account if user["account_id"] in kept_account_ids]
