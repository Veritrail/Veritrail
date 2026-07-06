import pytest

from app.services.evidence_artifact_safety import (
    ALLOWED_EVIDENCE_EXTENSIONS,
    EvidenceUploadRejected,
    MAX_EVIDENCE_UPLOAD_BYTES,
    build_stored_evidence_filename,
    validate_evidence_upload,
)

_ALLOWED = frozenset({".pdf", ".png", ".txt"})


def test_rejects_executable_extension():
    with pytest.raises(EvidenceUploadRejected, match="not allowed"):
        validate_evidence_upload("malware.exe", b"MZ", allowed_extensions=_ALLOWED)


def test_rejects_html_extension():
    with pytest.raises(EvidenceUploadRejected, match="not allowed"):
        validate_evidence_upload("payload.html", b"<html></html>", allowed_extensions=_ALLOWED)


def test_rejects_pdf_with_wrong_magic():
    with pytest.raises(EvidenceUploadRejected, match="does not match"):
        validate_evidence_upload("report.pdf", b"not-a-pdf", allowed_extensions=_ALLOWED)


def test_accepts_valid_pdf():
    validate_evidence_upload("report.pdf", b"%PDF-1.4", allowed_extensions=_ALLOWED)


def test_build_stored_filename_uses_uuid_and_extension():
    name = build_stored_evidence_filename("report.pdf", allowed_extensions=ALLOWED_EVIDENCE_EXTENSIONS)
    assert name.endswith(".pdf")
    assert "/" not in name
    assert "report" not in name


def test_build_stored_filename_ignores_untrusted_basename():
    name = build_stored_evidence_filename("../../evil.pdf", allowed_extensions=ALLOWED_EVIDENCE_EXTENSIONS)
    assert name.endswith(".pdf")
    assert "/" not in name
    assert ".." not in name
    assert "evil" not in name


def test_max_upload_bytes_is_25mb():
    assert MAX_EVIDENCE_UPLOAD_BYTES == 25 * 1024 * 1024
