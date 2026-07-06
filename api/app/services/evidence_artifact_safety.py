"""Upload safety checks for external evidence files."""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

MAX_EVIDENCE_UPLOAD_BYTES = 25 * 1024 * 1024
_TEXT_EXTENSIONS = frozenset({".txt", ".csv", ".json", ".md", ".log"})
ALLOWED_EVIDENCE_EXTENSIONS = _TEXT_EXTENSIONS | frozenset({".pdf", ".png", ".jpg", ".jpeg", ".webp"})

_BLOCKED_EXTENSIONS = frozenset(
    {
        ".exe",
        ".dll",
        ".bat",
        ".cmd",
        ".com",
        ".sh",
        ".ps1",
        ".js",
        ".vbs",
        ".msi",
        ".jar",
        ".zip",
        ".rar",
        ".7z",
        ".gz",
        ".tar",
        ".html",
        ".htm",
        ".svg",
        ".docm",
        ".xlsm",
    }
)

_MAGIC_PREFIXES: dict[str, tuple[bytes, ...]] = {
    ".pdf": (b"%PDF",),
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
    ".webp": (b"RIFF",),
}


class EvidenceUploadRejected(ValueError):
    pass


def validate_evidence_upload(filename: str, raw: bytes, *, allowed_extensions: frozenset[str]) -> None:
    suffix = Path(filename).suffix.lower()
    if suffix in _BLOCKED_EXTENSIONS:
        raise EvidenceUploadRejected(f"file type {suffix} is not allowed for evidence uploads")
    if suffix not in allowed_extensions:
        raise EvidenceUploadRejected("unsupported evidence file type")

    if not raw:
        raise EvidenceUploadRejected("empty evidence file")

    if b"\x00" in raw[:512] and suffix in {".txt", ".csv", ".md", ".log", ".json"}:
        raise EvidenceUploadRejected("text evidence file contains binary content")

    expected = _MAGIC_PREFIXES.get(suffix)
    if expected and not any(raw.startswith(prefix) for prefix in expected):
        raise EvidenceUploadRejected("file content does not match its extension")


def build_stored_evidence_filename(original_name: str, *, allowed_extensions: frozenset[str]) -> str:
    """Return a safe stored object name: uuid + validated extension only."""
    suffix = Path(original_name).suffix.lower()
    if suffix in _BLOCKED_EXTENSIONS or suffix not in allowed_extensions:
        raise EvidenceUploadRejected("unsupported evidence file type")
    return f"{uuid.uuid4()}{suffix}"


async def read_bounded_upload(file: Any, *, max_bytes: int = MAX_EVIDENCE_UPLOAD_BYTES) -> bytes:
    """Read an upload stream, rejecting payloads larger than max_bytes."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise EvidenceUploadRejected("evidence file is too large")
        chunks.append(chunk)
    return b"".join(chunks)
