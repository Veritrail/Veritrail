"""Optional ClamAV INSTREAM scan for uploaded evidence files."""
from __future__ import annotations

import socket
import struct

import structlog

from app.core.config import get_settings
from app.services.evidence_artifact_safety import EvidenceUploadRejected

log = structlog.get_logger()

_CLAMAV_TIMEOUT = 30


def scan_bytes(raw: bytes) -> None:
    settings = get_settings()
    quarantine = settings.EVIDENCE_UPLOAD_QUARANTINE_ENABLED
    if not settings.EVIDENCE_CLAMAV_ENABLED:
        if quarantine:
            raise EvidenceUploadRejected(
                "upload quarantine is enabled; set EVIDENCE_CLAMAV_ENABLED=true and ensure clamd is reachable"
            )
        return

    host = settings.EVIDENCE_CLAMAV_HOST.strip() or "127.0.0.1"
    port = settings.EVIDENCE_CLAMAV_PORT
    strict = quarantine or settings.APP_ENV != "dev"

    try:
        with socket.create_connection((host, port), timeout=_CLAMAV_TIMEOUT) as sock:
            sock.sendall(b"zINSTREAM\0")
            offset = 0
            chunk_size = 64 * 1024
            while offset < len(raw):
                chunk = raw[offset : offset + chunk_size]
                sock.sendall(struct.pack("!I", len(chunk)) + chunk)
                offset += len(chunk)
            sock.sendall(struct.pack("!I", 0))
            response = _read_clamd_response(sock)
    except OSError as exc:
        if not strict:
            log.warning("evidence_clamav.unavailable", host=host, port=port, error=str(exc))
            return
        raise EvidenceUploadRejected("malware scan unavailable; upload held in quarantine") from exc

    if not response:
        if not strict:
            log.warning("evidence_clamav.empty_response", host=host, port=port)
            return
        raise EvidenceUploadRejected("malware scan returned no response")

    if "FOUND" in response:
        threat = response.split("FOUND", 1)[-1].strip(" :\n")
        raise EvidenceUploadRejected(f"upload blocked by malware scan ({threat or 'threat detected'})")

    if "OK" not in response and "ERROR" in response:
        if not strict:
            log.warning("evidence_clamav.error_response", response=response[:200])
            return
        raise EvidenceUploadRejected("malware scan failed")


def _read_clamd_response(sock: socket.socket) -> str:
    sock.settimeout(_CLAMAV_TIMEOUT)
    chunks: list[bytes] = []
    while True:
        try:
            data = sock.recv(4096)
        except socket.timeout:
            break
        if not data:
            break
        chunks.append(data)
        if len(data) < 4096:
            break
    return b"".join(chunks).decode("utf-8", errors="replace").strip()
