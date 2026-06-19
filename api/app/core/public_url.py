"""Validation for user-supplied public HTTPS URLs (logos, etc.)."""
from __future__ import annotations

import ipaddress
from urllib.parse import urlparse

from app.services.trust_logo_storage import is_uploaded_trust_logo_path


class PublicUrlError(ValueError):
    pass


def validate_public_https_url(url: str, *, field: str = "URL", max_length: int = 1024) -> str:
    """Allow only public HTTPS URLs suitable for browser-loaded assets."""
    cleaned = url.strip()
    if not cleaned:
        raise PublicUrlError(f"{field} is required")
    if len(cleaned) > max_length:
        raise PublicUrlError(f"{field} must be {max_length} characters or fewer")

    parsed = urlparse(cleaned)
    if parsed.scheme != "https":
        raise PublicUrlError(f"{field} must use https://")
    if parsed.username or parsed.password:
        raise PublicUrlError(f"{field} must not include credentials")
    host = parsed.hostname
    if not host:
        raise PublicUrlError(f"{field} must include a hostname")

    lowered = host.lower()
    if lowered == "localhost" or lowered.endswith(".local") or lowered.endswith(".internal"):
        raise PublicUrlError(f"{field} must point to a public host")

    try:
        ip = ipaddress.ip_address(lowered)
    except ValueError:
        return cleaned

    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
        raise PublicUrlError(f"{field} must point to a public host")
    return cleaned


def sanitize_public_https_url(url: str | None, *, max_length: int = 1024) -> str | None:
    if not url or not url.strip():
        return None
    try:
        return validate_public_https_url(url, field="URL", max_length=max_length)
    except PublicUrlError:
        return None


def validate_trust_logo_reference(url: str, *, field: str = "Logo URL", max_length: int = 1024) -> str:
    cleaned = url.strip()
    if not cleaned:
        raise PublicUrlError(f"{field} is required")
    if is_uploaded_trust_logo_path(cleaned):
        return cleaned
    return validate_public_https_url(cleaned, field=field, max_length=max_length)


def resolve_public_asset_url(url: str | None, *, api_public_url: str) -> str | None:
    if not url or not url.strip():
        return None
    cleaned = url.strip()
    if cleaned.startswith("/uploads/"):
        if not is_uploaded_trust_logo_path(cleaned):
            return None
        return f"{api_public_url.rstrip('/')}{cleaned}"
    return sanitize_public_https_url(cleaned)
