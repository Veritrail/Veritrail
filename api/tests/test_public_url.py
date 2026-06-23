import pytest
import uuid

from app.core.public_url import (
    PublicUrlError,
    resolve_public_asset_url,
    sanitize_public_https_url,
    validate_public_https_url,
    validate_trust_logo_reference,
)
from app.services.trust_logo_storage import public_logo_path

SHUTTERSTOCK = (
    "https://www.shutterstock.com/shutterstock/photos/2104849118/display_1500/"
    "stock-vector-letter-a-initial-logo-design-acme-illustration-vector-symbol-icon-2104849118.jpg"
)


def test_validate_public_https_url_accepts_public_image_host():
    assert validate_public_https_url(SHUTTERSTOCK, field="Logo URL") == SHUTTERSTOCK


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com/logo.png",
        "javascript:alert(1)",
        "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'></svg>",
        "https://localhost/logo.png",
        "https://127.0.0.1/logo.png",
        "https://10.0.0.5/logo.png",
        "https://169.254.169.254/latest/meta-data/",
        "https://user:pass@example.com/logo.png",
    ],
)
def test_validate_public_https_url_rejects_unsafe_urls(url: str):
    with pytest.raises(PublicUrlError):
        validate_public_https_url(url, field="Logo URL")


def test_sanitize_public_https_url_returns_none_for_unsafe_values():
    assert sanitize_public_https_url("javascript:alert(1)") is None
    assert sanitize_public_https_url(SHUTTERSTOCK) == SHUTTERSTOCK


def test_trust_center_settings_rejects_non_https_logo():
    from app.routes.settings import TrustCenterSettingsIn
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        TrustCenterSettingsIn(
            is_enabled=True,
            subdomain_slug="acme",
            company_name="ACME Corp",
            company_logo_url="http://example.com/logo.png",
        )


def test_validate_trust_logo_reference_accepts_uploaded_path():
    org_id = "12345678-1234-5678-1234-567812345678"
    path = public_logo_path(uuid.UUID(org_id), "png")
    assert validate_trust_logo_reference(path, field="Logo URL") == path


def test_resolve_public_asset_url_expands_upload_path():
    org_id = "12345678-1234-5678-1234-567812345678"
    path = public_logo_path(uuid.UUID(org_id), "jpg")
    assert resolve_public_asset_url(path, api_public_url="http://localhost:8000") == (
        f"http://localhost:8000{path}"
    )
