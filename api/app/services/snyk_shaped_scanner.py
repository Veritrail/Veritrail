"""Snyk-shaped REST scanner adapter (Snyk, Orca, Aikido)."""
from __future__ import annotations

from typing import Any, Callable

import httpx

from app.services.scanner_types import ImportedScannerFinding, normalize_severity
from app.services.integration_input import normalize_api_base_url, normalize_snyk_org_id


def _headers_bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token.strip()}", "Accept": "application/json"}


def _headers_token(token: str, header: str = "Authorization") -> dict[str, str]:
    value = token.strip()
    if header.lower() == "authorization" and not value.lower().startswith("bearer "):
        value = f"Bearer {value}"
    return {header: value, "Accept": "application/json"}


def verify_bearer_get(url: str, token: str, *, label: str) -> dict[str, Any]:
    if not token.strip():
        raise ValueError(f"{label} API token is required")
    with httpx.Client(timeout=30.0, headers=_headers_bearer(token)) as client:
        resp = client.get(url)
    if resp.status_code >= 400:
        raise ValueError(f"{label} API error {resp.status_code}")
    return {"ok": True, "vendor": label}


def fetch_snyk_findings(cfg: dict[str, Any]) -> list[ImportedScannerFinding]:
    org_id = normalize_snyk_org_id(cfg.get("org_id") or "")
    token = (cfg.get("api_token") or "").strip()
    api_url = normalize_api_base_url(cfg.get("api_url") or "https://api.snyk.io")
    if not org_id or not token:
        raise ValueError("Snyk requires org_id and api_token")
    url = f"{api_url}/rest/orgs/{org_id}/issues"
    params = {"version": "2024-10-15", "limit": 100, "status": "open"}
    headers = {**_headers_bearer(token), "Content-Type": "application/vnd.api+json"}
    with httpx.Client(timeout=60.0) as client:
        resp = client.get(url, headers=headers, params=params)
    if resp.status_code >= 400:
        raise ValueError(f"Snyk sync error {resp.status_code}")
    data = resp.json().get("data") or []
    out: list[ImportedScannerFinding] = []
    for row in data:
        if not isinstance(row, dict):
            continue
        issue_id = row.get("id")
        attrs = row.get("attributes") or {}
        if not issue_id:
            continue
        title = attrs.get("title") or attrs.get("key") or f"Snyk issue {issue_id}"
        severity = attrs.get("effective_severity_level") or attrs.get("severity") or "medium"
        out.append(
            ImportedScannerFinding(
                external_id=str(issue_id),
                title=str(title),
                severity=normalize_severity(str(severity)),
                resource_label=attrs.get("project_name") or attrs.get("project_id"),
                extra={"issue_type": attrs.get("type"), "status": attrs.get("status")},
            )
        )
    return out


def fetch_orca_findings(cfg: dict[str, Any]) -> list[ImportedScannerFinding]:
    token = (cfg.get("api_token") or "").strip()
    api_url = (cfg.get("api_url") or "https://api.orcasecurity.io").rstrip("/")
    if not token:
        raise ValueError("Orca requires api_token")
    headers = _headers_token(token)
    with httpx.Client(timeout=60.0) as client:
        resp = client.get(
            f"{api_url}/api/alerts",
            headers=headers,
            params={"status": "open", "limit": 200},
        )
    if resp.status_code >= 400:
        raise ValueError(f"Orca sync error {resp.status_code}")
    payload = resp.json()
    rows = payload if isinstance(payload, list) else payload.get("data") or payload.get("alerts") or []
    out: list[ImportedScannerFinding] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        alert_id = row.get("id") or row.get("alert_id")
        if not alert_id:
            continue
        title = row.get("title") or row.get("rule_name") or f"Orca alert {alert_id}"
        severity = row.get("severity") or row.get("risk_level") or "medium"
        asset = row.get("asset") or row.get("resource") or {}
        resource = asset.get("name") or asset.get("id") if isinstance(asset, dict) else None
        out.append(
            ImportedScannerFinding(
                external_id=str(alert_id),
                title=str(title),
                severity=normalize_severity(str(severity)),
                resource_label=str(resource) if resource else None,
                extra={"category": row.get("category"), "type": row.get("type")},
            )
        )
    return out


def fetch_aikido_findings(cfg: dict[str, Any]) -> list[ImportedScannerFinding]:
    token = (cfg.get("api_token") or "").strip()
    api_url = (cfg.get("api_url") or "https://app.aikido.dev").rstrip("/")
    if not token:
        raise ValueError("Aikido requires api_token")
    headers = _headers_bearer(token)
    with httpx.Client(timeout=60.0) as client:
        resp = client.get(
            f"{api_url}/api/public/v1/issues",
            headers=headers,
            params={"filter_status": "open", "per_page": 100},
        )
    if resp.status_code >= 400:
        raise ValueError(f"Aikido sync error {resp.status_code}")
    payload = resp.json()
    rows = payload if isinstance(payload, list) else payload.get("issues") or payload.get("data") or []
    out: list[ImportedScannerFinding] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        issue_id = row.get("id") or row.get("issue_id")
        if issue_id is None:
            continue
        title = row.get("title") or row.get("rule") or f"Aikido issue {issue_id}"
        severity = row.get("severity") or row.get("severity_score") or "medium"
        out.append(
            ImportedScannerFinding(
                external_id=str(issue_id),
                title=str(title),
                severity=normalize_severity(str(severity)),
                resource_label=row.get("repo_name") or row.get("project_name"),
                extra={"type": row.get("type"), "status": row.get("status")},
            )
        )
    return out


FETCH_BY_VENDOR: dict[str, Callable[[dict[str, Any]], list[ImportedScannerFinding]]] = {
    "snyk": fetch_snyk_findings,
    "orca": fetch_orca_findings,
    "aikido": fetch_aikido_findings,
}
