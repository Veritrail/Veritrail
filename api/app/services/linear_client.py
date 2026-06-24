"""Linear API client for change-management evidence collection (read-only)."""
from __future__ import annotations

from typing import Any

import httpx

LINEAR_API = "https://api.linear.app/graphql"

_VIEWER_QUERY = """
query { viewer { id name email } }
"""

_ISSUES_QUERY = """
query Issues($first: Int!) {
  issues(first: $first, orderBy: updatedAt) {
    nodes {
      id
      identifier
      title
      url
      state { name type }
      assignee { name }
      creator { name }
      createdAt
      updatedAt
      completedAt
      labels(first: 20) { nodes { name } }
    }
  }
}
"""


def _auth_header(api_key: str) -> str:
    """Linear personal API keys go in the Authorization header verbatim.

    OAuth access tokens use a ``Bearer`` prefix; personal keys do not. We pass
    the key through unchanged so either form the caller supplies still works.
    """
    token = (api_key or "").strip()
    if not token:
        raise ValueError("Linear API key is required")
    return token


class LinearClient:
    def __init__(self, *, api_key: str):
        self._auth = _auth_header(api_key)

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=LINEAR_API,
            headers={
                "Authorization": self._auth,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            timeout=20,
        )

    def _post(self, client: httpx.Client, query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
        resp = client.post("", json={"query": query, "variables": variables or {}})
        if resp.status_code in (401, 403):
            raise ValueError("Linear rejected the API key (unauthorized)")
        resp.raise_for_status()
        data = resp.json()
        if data.get("errors"):
            messages = "; ".join(e.get("message", "unknown") for e in data["errors"])
            raise ValueError(f"Linear API error: {messages[:400]}")
        return data.get("data") or {}

    def verify(self) -> dict[str, Any]:
        """Validate the key and return the authenticated user identity."""
        with self._client() as client:
            viewer = self._post(client, _VIEWER_QUERY).get("viewer") or {}
        if not viewer.get("id"):
            raise ValueError("Could not resolve Linear viewer for this API key")
        return {
            "user_id": viewer.get("id"),
            "display_name": viewer.get("name"),
            "email": viewer.get("email"),
        }

    def list_issues(self, *, first: int = 50) -> list[dict[str, Any]]:
        """Return recent issues as normalized evidence rows (read-only)."""
        first = max(1, min(int(first or 50), 100))
        with self._client() as client:
            nodes = (self._post(client, _ISSUES_QUERY, {"first": first}).get("issues") or {}).get("nodes") or []
        return [
            {
                "id": n.get("id"),
                "identifier": n.get("identifier"),
                "title": n.get("title"),
                "url": n.get("url"),
                "state": (n.get("state") or {}).get("name"),
                "state_type": (n.get("state") or {}).get("type"),
                "assignee": (n.get("assignee") or {}).get("name"),
                "creator": (n.get("creator") or {}).get("name"),
                "created_at": n.get("createdAt"),
                "updated_at": n.get("updatedAt"),
                "completed_at": n.get("completedAt"),
                "labels": [lbl.get("name") for lbl in (n.get("labels") or {}).get("nodes", [])],
            }
            for n in nodes
        ]
