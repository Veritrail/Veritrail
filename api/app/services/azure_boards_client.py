"""Azure Boards client for remediation ticketing."""
from __future__ import annotations

import base64
from typing import Any

import httpx

from app.services.integration_input import (
    api_access_error,
    normalize_azure_devops_org_url,
    normalize_azure_devops_project,
)


class AzureBoardsClient:
    def __init__(self, *, org_url: str, pat: str):
        self.org_url = normalize_azure_devops_org_url(org_url)
        pat = pat.strip()
        if not pat:
            raise ValueError("Azure DevOps PAT is required")
        token = base64.b64encode(f":{pat}".encode()).decode()
        self._auth_header = {"Authorization": f"Basic {token}"}

    def _api(self, project: str, path: str) -> str:
        from urllib.parse import quote

        project_enc = quote(project.strip(), safe="")
        return f"{self.org_url}/{project_enc}/_apis/{path}"

    def verify(self, project: str) -> dict[str, Any]:
        project = normalize_azure_devops_project(project)
        if not project:
            raise ValueError("Azure DevOps project is required")
        with httpx.Client(timeout=30.0, headers=self._auth_header) as client:
            resp = client.get(self._api(project, "wit/workitemtypes?api-version=7.0"))
        if resp.status_code >= 400:
            raise ValueError(
                api_access_error(
                    "Azure Boards",
                    resp.status_code,
                    hint="Use org URL (e.g. https://dev.azure.com/myorg) and project name only.",
                )
            )
        types = [row.get("name") for row in (resp.json().get("value") or []) if row.get("name")]
        return {"project": project, "work_item_types": types[:10]}

    def create_work_item(self, *, project: str, title: str, description: str, work_item_type: str = "Task") -> dict[str, str]:
        project = normalize_azure_devops_project(project)
        wit = (work_item_type or "Task").strip()
        body = [
            {"op": "add", "path": "/fields/System.Title", "value": title},
            {"op": "add", "path": "/fields/System.Description", "value": description},
        ]
        from urllib.parse import quote

        wit_enc = quote(wit, safe="")
        url = self._api(project, f"wit/workitems/${wit_enc}?api-version=7.0")
        headers = {
            **self._auth_header,
            "Content-Type": "application/json-patch+json",
        }
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(url, headers=headers, json=body)
        if resp.status_code >= 400:
            raise ValueError(f"Azure Boards work item create failed ({resp.status_code})")
        data = resp.json()
        wid = data.get("id")
        link = (data.get("_links") or {}).get("html", {}).get("href") or ""
        return {"issue_key": str(wid), "issue_url": link}
