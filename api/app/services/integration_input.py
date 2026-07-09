"""Normalize user-supplied integration connection fields."""
from __future__ import annotations

from urllib.parse import urlparse


def normalize_api_base_url(raw: str, *, default_scheme: str = "https") -> str:
    """Return scheme://host for API base URLs (strip paths and query)."""
    value = raw.strip().rstrip("/")
    if not value:
        return ""
    if not value.startswith("http"):
        value = f"{default_scheme}://{value.lstrip('/')}"
    parsed = urlparse(value)
    if not parsed.netloc:
        raise ValueError("URL is required")
    return f"{parsed.scheme}://{parsed.netloc}"


def normalize_azure_devops_org_url(raw: str) -> str:
    value = raw.strip().rstrip("/")
    if not value:
        raise ValueError("Azure DevOps org URL is required")
    if not value.startswith("http") and "/" not in value:
        return f"https://dev.azure.com/{value.lstrip('/')}"
    if not value.startswith("http"):
        value = f"https://{value.lstrip('/')}"
    parsed = urlparse(value)
    host = parsed.netloc.lower()
    parts = [part for part in parsed.path.split("/") if part]
    if host == "dev.azure.com" and parts:
        return f"https://dev.azure.com/{parts[0]}"
    if host.endswith(".visualstudio.com") and parts:
        return f"https://{host}/{parts[0]}"
    if parts:
        return f"https://{host}/{parts[0]}"
    return f"https://{host}"


def normalize_azure_devops_project(raw: str) -> str:
    value = raw.strip()
    if not value:
        raise ValueError("Azure DevOps project is required")
    if "://" in value or value.startswith("dev.azure.com"):
        candidate = value if value.startswith("http") else f"https://{value.lstrip('/')}"
        parts = [part for part in urlparse(candidate).path.split("/") if part]
        if len(parts) >= 2:
            return parts[1]
    if "/" in value:
        parts = [part for part in value.split("/") if part]
        return parts[-1]
    return value


def normalize_datadog_site(raw: str) -> str:
    value = raw.strip().rstrip("/")
    if not value:
        return "datadoghq.com"
    host = urlparse(value).netloc.lower() if value.startswith("http") else value.lower().split("/")[0]
    for prefix in ("api.", "app."):
        if host.startswith(prefix):
            host = host[len(prefix) :]
    return host or "datadoghq.com"


def normalize_snyk_org_id(raw: str) -> str:
    value = raw.strip()
    if not value:
        return ""
    if "://" in value or "/" in value:
        candidate = value if value.startswith("http") else f"https://{value.lstrip('/')}"
        parts = [part for part in urlparse(candidate).path.split("/") if part]
        for marker in ("org", "orgs"):
            if marker in parts:
                idx = parts.index(marker)
                if idx + 1 < len(parts):
                    return parts[idx + 1]
        if parts:
            return parts[-1]
    return value


def api_access_error(service: str, status_code: int, *, hint: str | None = None) -> str:
    if status_code == 404:
        msg = f"{service} resource not found (404)."
        if hint:
            return f"{msg} {hint}"
        return msg
    if status_code in (401, 403):
        return (
            f"{service} authentication failed or insufficient permissions ({status_code}). "
            "Check credentials and required scopes."
        )
    return f"{service} API error ({status_code})"
