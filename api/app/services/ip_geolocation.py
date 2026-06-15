"""IP geolocation for session display (ipapi.co free tier)."""

from __future__ import annotations

import ipaddress
import logging

import httpx

log = logging.getLogger(__name__)

_IPAPI_HEADERS = {"User-Agent": "Vigil/1.0"}


def _is_public_ip(ip: str) -> bool:
    try:
        return ipaddress.ip_address(ip).is_global
    except ValueError:
        return False


def _parse_ipapi_response(data: dict) -> dict[str, str | None]:
    if data.get("error"):
        return {"city": None, "region": None, "country": None}
    return {
        "city": (data.get("city") or None),
        "region": (data.get("region") or data.get("region_code") or None),
        "country": (data.get("country_name") or data.get("country") or None),
    }


def _fetch_ipapi(url: str) -> dict[str, str | None]:
    try:
        with httpx.Client(timeout=2.5) as client:
            resp = client.get(url, headers=_IPAPI_HEADERS)
            if resp.status_code != 200:
                return {"city": None, "region": None, "country": None}
            return _parse_ipapi_response(resp.json())
    except Exception:
        log.debug("ip_geolocation.lookup_failed", exc_info=True)
        return {"city": None, "region": None, "country": None}


def lookup_ip_geolocation(ip: str | None) -> dict[str, str | None]:
    """Resolve city/region/country for an IP, or egress IP when client IP is private."""
    if ip and _is_public_ip(ip):
        return _fetch_ipapi(f"https://ipapi.co/{ip}/json/")
    # Local Docker/Vite dev: the request IP is RFC1918; ask ipapi for this host's public IP.
    return _fetch_ipapi("https://ipapi.co/json/")


def format_location(city: str | None, region: str | None, country: str | None) -> str | None:
    parts = [p.strip() for p in (city, region, country) if p and str(p).strip()]
    return ", ".join(parts) if parts else None
