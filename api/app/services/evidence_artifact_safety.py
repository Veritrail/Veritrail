"""Upload safety checks for external evidence files."""
from __future__ import annotations

from pathlib import Path

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
