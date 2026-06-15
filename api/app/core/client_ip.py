"""Resolve the caller's IP for audit/UI helpers (e.g. remediation CLI)."""

from __future__ import annotations

from fastapi import Request


def _normalize_ip(ip: str) -> str:
    if ip.startswith("::ffff:"):
        return ip[7:]
    return ip


def client_ip_from_request(request: Request) -> str | None:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return _normalize_ip(fwd.split(",")[0].strip())
    if request.client:
        return _normalize_ip(request.client.host)
    return None
