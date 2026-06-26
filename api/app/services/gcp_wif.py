"""GCP Workload Identity Federation — OIDC issuer + STS token exchange."""
from __future__ import annotations

import base64
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import jwt
from jose.constants import ALGORITHMS

from app.core.config import get_settings

GCP_SCOPE = "https://www.googleapis.com/auth/cloud-platform"
AUTH_WORKLOAD_IDENTITY = "workload_identity"
AUTH_SERVICE_ACCOUNT_KEY = "service_account_key"

_DEV_SIGNING: tuple[str, str, str] | None = None


def _dev_signing_material() -> tuple[str, str, str]:
    """Ephemeral RSA key for local dev when GCP_WIF_JWT_PRIVATE_KEY is unset."""
    global _DEV_SIGNING
    if _DEV_SIGNING is not None:
        return _DEV_SIGNING
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    _DEV_SIGNING = (pem, ALGORITHMS.RS256, "veritrail-wif-dev")
    return _DEV_SIGNING


def generate_wif_subject() -> str:
    return secrets.token_urlsafe(24)


def issuer_uri() -> str:
    settings = get_settings()
    configured = (settings.GCP_WIF_ISSUER_URI or "").strip().rstrip("/")
    if configured:
        return configured
    return f"{settings.API_PUBLIC_URL.rstrip('/')}/v1/integrations/gcp/wif"


def token_audience() -> str:
    return get_settings().GCP_WIF_VERITRAIL_AUDIENCE


def _signing_key_and_alg() -> tuple[str, str, str]:
    """Return (private_key_pem, algorithm, key_id)."""
    settings = get_settings()
    pem = (settings.GCP_WIF_JWT_PRIVATE_KEY or "").strip()
    kid = (settings.GCP_WIF_JWT_KEY_ID or "veritrail-wif-1").strip()
    if pem:
        return pem, ALGORITHMS.RS256, kid
    if settings.APP_ENV == "dev":
        return _dev_signing_material()
    raise ValueError(
        "GCP_WIF_JWT_PRIVATE_KEY is required for Workload Identity Federation in production. "
        "Generate an RSA key pair and configure the public key via the JWKS endpoint."
    )


def issue_subject_token(wif_subject: str, *, ttl_minutes: int = 15) -> str:
    """Issue an OIDC JWT presented to Google STS during token exchange."""
    private_key, algorithm, kid = _signing_key_and_alg()
    now = datetime.now(timezone.utc)
    payload = {
        "iss": issuer_uri(),
        "sub": wif_subject,
        "aud": token_audience(),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ttl_minutes)).timestamp()),
    }
    return jwt.encode(payload, private_key, algorithm=algorithm, headers={"kid": kid})


def build_wif_audience(project_number: str, pool_id: str, provider_id: str) -> str:
    return (
        f"//iam.googleapis.com/projects/{project_number}/locations/global/"
        f"workloadIdentityPools/{pool_id}/providers/{provider_id}"
    )


def principal_member(project_number: str, pool_id: str, wif_subject: str) -> str:
    return (
        f"principal://iam.googleapis.com/projects/{project_number}/locations/global/"
        f"workloadIdentityPools/{pool_id}/subject/{wif_subject}"
    )


def impersonation_url(service_account_email: str) -> str:
    return (
        "https://iamcredentials.googleapis.com/v1/projects/-/"
        f"serviceAccounts/{service_account_email}:generateAccessToken"
    )


def oidc_discovery_document() -> dict[str, Any]:
    base = issuer_uri()
    return {
        "issuer": base,
        "jwks_uri": f"{base}/jwks",
        "response_types_supported": ["id_token"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
    }


def _rsa_public_jwk() -> dict[str, Any]:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    private_key, _, kid = _signing_key_and_alg()
    key = serialization.load_pem_private_key(private_key.encode(), password=None)
    if not isinstance(key, rsa.RSAPrivateKey):
        raise ValueError("GCP WIF signing key must be RSA")
    pub = key.public_key().public_numbers()
    def _b64_uint(val: int) -> str:
        raw = val.to_bytes((val.bit_length() + 7) // 8, byteorder="big")
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    return {
        "kty": "RSA",
        "alg": "RS256",
        "use": "sig",
        "kid": kid,
        "n": _b64_uint(pub.n),
        "e": _b64_uint(pub.e),
    }


def jwks_document() -> dict[str, Any]:
    return {"keys": [_rsa_public_jwk()]}


class _SubjectTokenSupplier:
    def __init__(self, wif_subject: str):
        self._wif_subject = wif_subject

    def get_subject_token(self, _context, _request) -> str:
        return issue_subject_token(self._wif_subject)


def exchange_wif_access_token(
    *,
    wif_subject: str,
    audience: str,
    service_account_email: str,
) -> str:
    """Exchange Veritrail OIDC token for a short-lived GCP access token via WIF + SA impersonation."""
    try:
        from google.auth import identity_pool
        from google.auth.transport.requests import Request
    except ImportError as e:
        raise ValueError("google-auth package is required for GCP WIF") from e

    creds = identity_pool.Credentials(
        audience=audience,
        subject_token_type="urn:ietf:params:oauth:token-type:jwt",
        token_url="https://sts.googleapis.com/v1/token",
        service_account_impersonation_url=impersonation_url(service_account_email),
        subject_token_supplier=_SubjectTokenSupplier(wif_subject),
    )
    creds = creds.with_scopes([GCP_SCOPE])
    creds.refresh(Request())
    if not creds.token:
        raise ValueError("GCP WIF token exchange returned no access token")
    return creds.token


def setup_manifest(
    *,
    project_id: str,
    wif_subject: str,
    project_number: str | None = None,
) -> dict[str, Any]:
    """Customer-facing setup parameters for Terraform / gcloud."""
    settings = get_settings()
    iss = issuer_uri()
    aud = token_audience()
    pool_id = settings.GCP_WIF_DEFAULT_POOL_ID
    provider_id = settings.GCP_WIF_DEFAULT_PROVIDER_ID
    sa_name = settings.GCP_WIF_DEFAULT_SA_NAME
    sa_email = (
        f"{sa_name}@{project_id}.iam.gserviceaccount.com"
        if project_id
        else f"{sa_name}@PROJECT_ID.iam.gserviceaccount.com"
    )
    pnum = project_number or "PROJECT_NUMBER"
    audience = build_wif_audience(pnum, pool_id, provider_id)
    member = principal_member(pnum, pool_id, wif_subject)
    return {
        "auth_method": AUTH_WORKLOAD_IDENTITY,
        "issuer_uri": iss,
        "token_audience": aud,
        "jwks_uri": f"{iss}/jwks",
        "wif_subject": wif_subject,
        "project_id": project_id,
        "project_number": project_number,
        "pool_id": pool_id,
        "provider_id": provider_id,
        "service_account_email": sa_email,
        "wif_audience": audience,
        "principal_member": member,
        "terraform_path": "infra/gcp/wif-setup",
        "gcloud_script_path": "infra/gcp/wif-setup/setup.sh",
    }
