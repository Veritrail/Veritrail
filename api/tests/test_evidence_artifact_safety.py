import pytest

from app.services.evidence_artifact_safety import EvidenceUploadRejected, validate_evidence_upload

_ALLOWED = frozenset({".pdf", ".png", ".txt"})


def test_rejects_executable_extension():
    with pytest.raises(EvidenceUploadRejected, match="not allowed"):
        validate_evidence_upload("malware.exe", b"MZ", allowed_extensions=_ALLOWED)


def test_rejects_pdf_with_wrong_magic():
    with pytest.raises(EvidenceUploadRejected, match="does not match"):
        validate_evidence_upload("report.pdf", b"not-a-pdf", allowed_extensions=_ALLOWED)


def test_accepts_valid_pdf():
    validate_evidence_upload("report.pdf", b"%PDF-1.4", allowed_extensions=_ALLOWED)
