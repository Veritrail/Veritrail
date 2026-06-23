"""Ed25519 signatures for evidence pack integrity manifests."""
from __future__ import annotations

import base64
import hashlib
import json
from functools import lru_cache

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)

from app.core.config import get_settings

ALGORITHM = "ed25519"
SIGNED_ARTIFACT = "checksum_manifest.json"
KEY_ID = "veritrail-evidence-v1"
REMEDIATION_KEY_ID = "veritrail-remediation-v1"


@lru_cache(maxsize=1)
def _private_key() -> Ed25519PrivateKey | None:
    raw = (get_settings().EVIDENCE_PACK_SIGNING_KEY or "").strip()
    if not raw:
        return None
    try:
        seed = base64.urlsafe_b64decode(raw + "==")
        if len(seed) != 32:
            seed = base64.b64decode(raw)
        return Ed25519PrivateKey.from_private_bytes(seed[:32])
    except Exception:
        return None


def signing_enabled() -> bool:
    return _private_key() is not None


def public_key_base64() -> str | None:
    key = _private_key()
    if not key:
        return None
    pub = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return base64.b64encode(pub).decode("ascii")


def build_pack_signature(checksum_manifest_body: str) -> dict | None:
    """Sign checksum_manifest.json bytes. Returns None when signing key not configured."""
    key = _private_key()
    if not key:
        return None
    payload = checksum_manifest_body.encode("utf-8")
    sig = key.sign(payload)
    return {
        "algorithm": ALGORITHM,
        "key_id": KEY_ID,
        "signed_artifact": SIGNED_ARTIFACT,
        "payload_sha256": hashlib.sha256(payload).hexdigest(),
        "signature_base64": base64.b64encode(sig).decode("ascii"),
        "public_key_base64": public_key_base64(),
        "verify": (
            "Verify: SHA-256(checksum_manifest.json UTF-8) matches payload_sha256; "
            "Ed25519 verify signature with public_key_base64."
        ),
    }


def sign_payload(payload_bytes: bytes, *, key_id: str = REMEDIATION_KEY_ID) -> dict | None:
    """Sign arbitrary canonical plan bytes (remediation plans, etc.)."""
    key = _private_key()
    if not key:
        return None
    sig = key.sign(payload_bytes)
    return {
        "algorithm": ALGORITHM,
        "key_id": key_id,
        "payload_sha256": hashlib.sha256(payload_bytes).hexdigest(),
        "signature_base64": base64.b64encode(sig).decode("ascii"),
        "public_key_base64": public_key_base64(),
    }


def verify_payload(payload_bytes: bytes, signature_doc: dict) -> bool:
    pub_b64 = signature_doc.get("public_key_base64")
    sig_b64 = signature_doc.get("signature_base64")
    if not pub_b64 or not sig_b64:
        return False
    if hashlib.sha256(payload_bytes).hexdigest() != signature_doc.get("payload_sha256"):
        return False
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    pub = Ed25519PublicKey.from_public_bytes(base64.b64decode(pub_b64))
    pub.verify(base64.b64decode(sig_b64), payload_bytes)
    return True


def verify_pack_signature(checksum_manifest_body: str, signature_doc: dict) -> bool:
    pub_b64 = signature_doc.get("public_key_base64")
    sig_b64 = signature_doc.get("signature_base64")
    if not pub_b64 or not sig_b64:
        return False
    payload = checksum_manifest_body.encode("utf-8")
    if hashlib.sha256(payload).hexdigest() != signature_doc.get("payload_sha256"):
        return False
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    pub = Ed25519PublicKey.from_public_bytes(base64.b64decode(pub_b64))
    pub.verify(base64.b64decode(sig_b64), payload)
    return True
