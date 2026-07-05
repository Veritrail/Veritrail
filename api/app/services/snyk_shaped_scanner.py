"""Snyk-shaped REST scanner adapter (Snyk, Orca, Aikido)."""
from __future__ import annotations

from typing import Any, Callable

import httpx

from app.services.scanner_types import ImportedScannerFinding, normalize_severity
from app.services.integration_input import normalize_api_base_url, normalize_snyk_org_id


def _headers_bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token.strip()}", "Accept": "application/json"}


def _headers_snyk_token(token: str) -> dict[str, str]:
    # Snyk REST API uses the `token` auth scheme for API tokens/PATs — `Bearer`
    # is reserved for Snyk Apps OAuth access_tokens and gets a 401 here.
    # https://docs.snyk.io/developer-tools/snyk-api/authentication-for-api
    return {"Authorization": f"token {token.strip()}", "Accept": "application/json"}


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


def verify_snyk_token_get(url: str, token: str, *, label: str) -> dict[str, Any]:
    if not token.strip():
        raise ValueError(f"{label} API token is required")
    with httpx.Client(timeout=30.0, headers=_headers_snyk_token(token)) as client:
        resp = client.get(url)
    if resp.status_code >= 400:
        raise ValueError(f"{label} API error {resp.status_code}")
    return {"ok": True, "vendor": label}


# NOTE: cannot be live-tested against a free/Team Snyk account — Snyk's REST
# API (used below) is Enterprise-plan-only regardless of token type (legacy API
# token or PAT); free/Team tokens 403 on every REST endpoint by design.
# https://docs.snyk.io/developer-tools/snyk-api/authentication-for-api/personal-access-tokens-pats
# Correctness here rests on doc-verified request shape (auth scheme, path,
# params), not a live round-trip. Confirmed only that auth scheme itself
# (`token <key>`, not `Bearer`) is right, since that flipped 401 -> 403.
def fetch_snyk_findings(cfg: dict[str, Any]) -> list[ImportedScannerFinding]:
    org_id = normalize_snyk_org_id(cfg.get("org_id") or "")
    token = (cfg.get("api_token") or "").strip()
    api_url = normalize_api_base_url(cfg.get("api_url") or "https://api.snyk.io")
    if not org_id or not token:
        raise ValueError("Snyk requires org_id and api_token")
    url = f"{api_url}/rest/orgs/{org_id}/issues"
    params = {"version": "2024-10-15", "limit": 100, "status": "open"}
    headers = {**_headers_snyk_token(token), "Content-Type": "application/vnd.api+json"}
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


def aikido_access_token(client_id: str, client_secret: str) -> str:
    """Exchange OAuth2 client credentials for a short-lived bearer token.

    Confirmed against Aikido's own docs: "Aikido's API only supports OAuth 2.0's
    Client Credentials grant" — no static key auth exists, despite the
    dashboard calling the client_id/client_secret pair an "API key".
    https://apidocs.aikido.dev/reference/authorization

    NOTE: like Snyk, cannot be live-tested on a free Aikido account — the
    Public REST API is a paid-plan feature (shows "Upgrade" on Free in the
    dashboard's Integrations page). Correctness here rests on the doc-verified
    request shape, not a live round-trip.
    """
    if not client_id.strip() or not client_secret.strip():
        raise ValueError("Aikido requires client_id and client_secret")
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(
            "https://app.aikido.dev/api/oauth/token",
            auth=(client_id.strip(), client_secret.strip()),
            data={"grant_type": "client_credentials"},
            headers={"Accept": "application/json"},
        )
    if resp.status_code >= 400:
        raise ValueError(f"Aikido token exchange error {resp.status_code}")
    token = resp.json().get("access_token")
    if not token:
        raise ValueError("Aikido token exchange did not return an access_token")
    return str(token)


def fetch_aikido_findings(cfg: dict[str, Any]) -> list[ImportedScannerFinding]:
    client_id = (cfg.get("client_id") or "").strip()
    client_secret = (cfg.get("client_secret") or "").strip()
    access_token = aikido_access_token(client_id, client_secret)
    headers = _headers_bearer(access_token)
    with httpx.Client(timeout=60.0) as client:
        resp = client.get(
            "https://app.aikido.dev/api/public/v1/issues/export",
            headers=headers,
            params={"filter_status": "open", "per_page": 100, "format": "json"},
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
        title = row.get("title") or row.get("rule") or row.get("rule_name") or f"Aikido issue {issue_id}"
        severity = row.get("severity") or row.get("severity_score") or "medium"
        repo = row.get("code_repo") or row.get("container_repo") or {}
        resource = repo.get("name") if isinstance(repo, dict) else row.get("repo_name") or row.get("project_name")
        out.append(
            ImportedScannerFinding(
                external_id=str(issue_id),
                title=str(title),
                severity=normalize_severity(str(severity)),
                resource_label=resource,
                extra={"type": row.get("type"), "status": row.get("status")},
            )
        )
    return out


FETCH_BY_VENDOR: dict[str, Callable[[dict[str, Any]], list[ImportedScannerFinding]]] = {
    "snyk": fetch_snyk_findings,
    "orca": fetch_orca_findings,
    "aikido": fetch_aikido_findings,
}
