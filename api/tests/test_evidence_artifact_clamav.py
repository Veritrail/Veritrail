from unittest.mock import MagicMock, patch

import pytest

from app.services.evidence_artifact_clamav import scan_bytes
from app.services.evidence_artifact_safety import EvidenceUploadRejected


def test_clamav_disabled_is_noop(monkeypatch):
    monkeypatch.setenv("EVIDENCE_CLAMAV_ENABLED", "false")
    from app.core.config import get_settings

    get_settings.cache_clear()
    scan_bytes(b"clean")
    get_settings.cache_clear()


def test_clamav_found_blocks_upload(monkeypatch):
    monkeypatch.setenv("EVIDENCE_CLAMAV_ENABLED", "true")
    monkeypatch.setenv("APP_ENV", "dev")
    from app.core.config import get_settings

    get_settings.cache_clear()

    class FakeSock:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def sendall(self, data):
            return None

        def recv(self, size):
            return b"stream: Eicar-Test-Signature FOUND\n"

        def settimeout(self, _):
            return None

    with patch("app.services.evidence_artifact_clamav.socket.create_connection", return_value=FakeSock()):
        with pytest.raises(EvidenceUploadRejected, match="malware scan"):
            scan_bytes(b"eicar")

    get_settings.cache_clear()


def test_clamav_unavailable_skips_in_dev(monkeypatch):
    monkeypatch.setenv("EVIDENCE_CLAMAV_ENABLED", "true")
    monkeypatch.setenv("EVIDENCE_UPLOAD_QUARANTINE_ENABLED", "false")
    monkeypatch.setenv("APP_ENV", "dev")
    from app.core.config import get_settings

    get_settings.cache_clear()

    with patch(
        "app.services.evidence_artifact_clamav.socket.create_connection",
        side_effect=OSError("connection refused"),
    ):
        scan_bytes(b"payload")

    get_settings.cache_clear()


def test_quarantine_requires_clamav_enabled(monkeypatch):
    monkeypatch.setenv("EVIDENCE_CLAMAV_ENABLED", "false")
    monkeypatch.setenv("EVIDENCE_UPLOAD_QUARANTINE_ENABLED", "true")
    from app.core.config import get_settings

    get_settings.cache_clear()
    with pytest.raises(EvidenceUploadRejected, match="quarantine"):
        scan_bytes(b"payload")
    get_settings.cache_clear()


def test_quarantine_blocks_when_clamav_unavailable(monkeypatch):
    monkeypatch.setenv("EVIDENCE_CLAMAV_ENABLED", "true")
    monkeypatch.setenv("EVIDENCE_UPLOAD_QUARANTINE_ENABLED", "true")
    monkeypatch.setenv("APP_ENV", "dev")
    from app.core.config import get_settings

    get_settings.cache_clear()
    with patch(
        "app.services.evidence_artifact_clamav.socket.create_connection",
        side_effect=OSError("connection refused"),
    ):
        with pytest.raises(EvidenceUploadRejected, match="quarantine"):
            scan_bytes(b"payload")
    get_settings.cache_clear()
