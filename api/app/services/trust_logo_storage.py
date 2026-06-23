"""Local Trust Center logo storage (dev / single-node deployments)."""
from __future__ import annotations

import re
import uuid
from pathlib import Path

from app.core.config import get_settings

MAX_TRUST_LOGO_BYTES = 512 * 1024
TRUST_LOGO_DIR = Path("trust-logos")
UPLOADED_TRUST_LOGO_RE = re.compile(
    r"^/uploads/trust-logos/[0-9a-f-]{36}\.(png|jpe?g|webp|gif)$",
    re.IGNORECASE,
)


class TrustLogoError(ValueError):
    pass


def upload_root() -> Path:
    root = Path(get_settings().LOCAL_UPLOAD_DIR)
    root.mkdir(parents=True, exist_ok=True)
    return root


def trust_logo_dir() -> Path:
    directory = upload_root() / TRUST_LOGO_DIR
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def is_uploaded_trust_logo_path(url: str | None) -> bool:
    if not url:
        return False
    return bool(UPLOADED_TRUST_LOGO_RE.match(url.strip()))


def public_logo_path(org_id: uuid.UUID, ext: str) -> str:
    return f"/uploads/trust-logos/{org_id}.{ext}"


def _detect_image_type(content: bytes) -> str:
    if len(content) < 12:
        raise TrustLogoError("Logo file is too small")
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if content.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if content[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return "webp"
    raise TrustLogoError("Logo must be a PNG, JPG, WEBP, or GIF image")


def save_trust_logo(org_id: uuid.UUID, content: bytes) -> str:
    if len(content) > MAX_TRUST_LOGO_BYTES:
        raise TrustLogoError("Logo must be 512 KB or smaller")

    ext = _detect_image_type(content)
    directory = trust_logo_dir()

    for old in directory.glob(f"{org_id}.*"):
        old.unlink(missing_ok=True)

    target = directory / f"{org_id}.{ext}"
    target.write_bytes(content)
    return public_logo_path(org_id, ext)


def delete_trust_logo(org_id: uuid.UUID) -> None:
    directory = trust_logo_dir()
    for old in directory.glob(f"{org_id}.*"):
        old.unlink(missing_ok=True)
