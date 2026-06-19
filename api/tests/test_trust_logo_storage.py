import uuid

import pytest

from app.services.trust_logo_storage import (
    TrustLogoError,
    is_uploaded_trust_logo_path,
    public_logo_path,
    save_trust_logo,
)


PNG_1X1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_save_trust_logo_writes_public_path(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCAL_UPLOAD_DIR", str(tmp_path))
    from app.core.config import get_settings

    get_settings.cache_clear()

    org_id = uuid.uuid4()
    path = save_trust_logo(org_id, PNG_1X1)
    assert path == public_logo_path(org_id, "png")
    assert is_uploaded_trust_logo_path(path)
    assert (tmp_path / "trust-logos" / f"{org_id}.png").is_file()


def test_save_trust_logo_rejects_invalid_bytes(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCAL_UPLOAD_DIR", str(tmp_path))
    from app.core.config import get_settings

    get_settings.cache_clear()

    with pytest.raises(TrustLogoError):
        save_trust_logo(uuid.uuid4(), b"not-an-image")
