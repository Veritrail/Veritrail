"""GCP service account impersonation — Veritrail platform SA → customer scanner SA."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.services.gcp_wif import AUTH_SERVICE_ACCOUNT_IMPERSONATION, GCP_SCOPE

__all__ = [
    "AUTH_SERVICE_ACCOUNT_IMPERSONATION",
    "exchange_impersonation_access_token",
    "impersonation_setup_manifest",
    "is_platform_sa_configured",
    "platform_sa_config_error",
    "platform_sa_email",
]


def _load_platform_sa_json() -> dict[str, Any]:
    settings = get_settings()
    raw = (settings.VERITRAIL_GCP_PLATFORM_SA_JSON or "").strip()
    if not raw:
        path = (settings.VERITRAIL_GCP_PLATFORM_SA_JSON_PATH or "").strip()
        if path:
            raw = Path(path).read_text(encoding="utf-8").strip()
    if not raw:
        return {}
    try:
        info = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError("VERITRAIL_GCP_PLATFORM_SA_JSON is invalid JSON") from e
    if not info.get("client_email") or not info.get("private_key"):
        raise ValueError("Veritrail GCP platform SA JSON must include client_email and private_key")
    return info


def platform_sa_email() -> str | None:
    configured = (get_settings().VERITRAIL_GCP_PLATFORM_SA_EMAIL or "").strip()
    if configured:
        return configured
    info = _load_platform_sa_json()
    email = (info.get("client_email") or "").strip()
    return email or None


def is_platform_sa_configured() -> bool:
    try:
        return bool(platform_sa_email() and _load_platform_sa_json())
    except ValueError:
        return False


def platform_sa_config_error() -> str | None:
    """Human-readable error when platform SA is missing; None when configured."""
    settings = get_settings()
    if is_platform_sa_configured():
        return None
    if settings.APP_ENV == "dev":
        return (
            "Veritrail GCP platform service account is not configured. "
            "Set VERITRAIL_GCP_PLATFORM_SA_JSON (or VERITRAIL_GCP_PLATFORM_SA_JSON_PATH) "
            "and VERITRAIL_GCP_PLATFORM_SA_EMAIL for local impersonation tests."
        )
    return (
        "Veritrail GCP platform service account is not configured. "
        "Contact your Veritrail operator to set VERITRAIL_GCP_PLATFORM_SA_JSON."
    )


def exchange_impersonation_access_token(*, service_account_email: str) -> str:
    """Use Veritrail platform SA credentials to impersonate the customer scanner SA."""
    err = platform_sa_config_error()
    if err:
        raise ValueError(err)
    target = (service_account_email or "").strip()
    if not target:
        raise ValueError("GCP scanner service account email is required")

    try:
        from google.auth import impersonated_credentials
        from google.auth.transport.requests import Request
        from google.oauth2 import service_account
    except ImportError as e:
        raise ValueError("google-auth package is required for GCP impersonation") from e

    source = service_account.Credentials.from_service_account_info(
        _load_platform_sa_json(),
        scopes=[GCP_SCOPE],
    )
    creds = impersonated_credentials.Credentials(
        source_credentials=source,
        target_principal=target,
        target_scopes=[GCP_SCOPE],
        lifetime=3600,
    )
    creds.refresh(Request())
    if not creds.token:
        raise ValueError("GCP impersonation returned no access token")
    return creds.token


def impersonation_setup_manifest(*, project_id: str) -> dict[str, Any]:
    """Customer-facing setup parameters for scanner SA + TokenCreator grant."""
    settings = get_settings()
    pid = project_id.strip()
    sa_name = settings.GCP_WIF_DEFAULT_SA_NAME
    scanner_email = (
        f"{sa_name}@{pid}.iam.gserviceaccount.com"
        if pid
        else f"{sa_name}@PROJECT_ID.iam.gserviceaccount.com"
    )
    platform_email = platform_sa_email() or "VERITRAIL_PLATFORM_SA_EMAIL"
    return {
        "auth_method": AUTH_SERVICE_ACCOUNT_IMPERSONATION,
        "project_id": pid,
        "platform_sa_email": platform_email,
        "scanner_sa_email": scanner_email,
        "terraform_path": "infra/gcp/sa-setup",
        "gcloud_script_path": "infra/gcp/sa-setup/setup.sh",
        "platform_sa_configured": is_platform_sa_configured(),
    }
