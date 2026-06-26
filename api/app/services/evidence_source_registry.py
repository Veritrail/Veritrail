"""Workspace-level source-of-evidence registry (minimal Release 1.5)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

EVIDENCE_SOURCE_CATEGORIES: list[dict[str, Any]] = [
    {
        "key": "identity_access",
        "label": "Identity & access",
        "composite_ids": ["identity_governance"],
    },
    {
        "key": "asset_inventory",
        "label": "Asset inventory",
        "composite_ids": ["asset_inventory"],
    },
    {
        "key": "secure_sdlc",
        "label": "Secure SDLC",
        "composite_ids": ["secure_sdlc"],
    },
    {
        "key": "change_management",
        "label": "Change management",
        "composite_ids": ["change_management"],
    },
    {
        "key": "data_protection",
        "label": "Data protection",
        "composite_ids": ["data_protection"],
    },
    {
        "key": "vulnerability_management",
        "label": "Vulnerability management",
        "composite_ids": ["vulnerability_management", "container_vulnerability_monitoring"],
    },
    {
        "key": "logging_monitoring",
        "label": "Logging & monitoring",
        "composite_ids": ["logging_monitoring"],
    },
    {
        "key": "backup_resilience",
        "label": "Backup & resilience",
        "composite_ids": ["backup_resilience"],
    },
    {
        "key": "endpoint_security",
        "label": "Endpoint security",
        "composite_ids": ["endpoint_security"],
    },
    {
        "key": "mdm_endpoint",
        "label": "Device management (MDM)",
        "composite_ids": [],
    },
]

# AWS cannot verify corporate laptops/EDR/MDM — coverage requires external proof.
EXTERNAL_EVIDENCE_ONLY_CATEGORY_KEYS = frozenset({"endpoint_security", "mdm_endpoint"})

ENDPOINT_SECURITY_TOOLS = [
    "CrowdStrike",
    "Microsoft Defender for Endpoint",
    "SentinelOne",
    "Jamf Protect",
    "Intune",
    "Other",
]

MDM_ENDPOINT_TOOLS = [
    "Microsoft Intune",
    "Jamf Pro",
    "Jamf Protect",
    "Kandji",
    "Other",
]

_COMPOSITE_TO_CATEGORY: dict[str, str] = {}
for _cat in EVIDENCE_SOURCE_CATEGORIES:
    for _cid in _cat["composite_ids"]:
        if _cid not in _COMPOSITE_TO_CATEGORY:
            _COMPOSITE_TO_CATEGORY[_cid] = _cat["key"]


def category_for_composite(composite_id: str | None) -> str | None:
    if not composite_id:
        return None
    return _COMPOSITE_TO_CATEGORY.get(composite_id)


def get_evidence_sources(stored: dict | None) -> dict[str, dict[str, Any]]:
    raw = (stored or {}).get("evidence_sources") or {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for cat in EVIDENCE_SOURCE_CATEGORIES:
        key = cat["key"]
        entry = raw.get(key)
        if isinstance(entry, dict) and entry.get("vendor"):
            out[key] = dict(entry)
    return out


def merge_evidence_sources(
    stored: dict | None,
    updates: dict[str, dict[str, Any]],
    *,
    user_id: str | None = None,
) -> dict[str, dict[str, Any]]:
    current = dict((stored or {}).get("evidence_sources") or {})
    now = datetime.now(timezone.utc).isoformat()
    valid_keys = {c["key"] for c in EVIDENCE_SOURCE_CATEGORIES}
    for key, patch in updates.items():
        if key not in valid_keys:
            continue
        vendor = (patch.get("vendor") or "").strip()
        if not vendor:
            current.pop(key, None)
            continue
        entry = dict(current.get(key) or {})
        entry["vendor"] = vendor[:120]
        for field in ("owner", "cadence", "scope_description", "source_type"):
            if field in patch:
                val = patch.get(field)
                entry[field] = (val or "").strip()[:500] or None
        entry["updated_at"] = now
        if user_id:
            entry["updated_by_user_id"] = user_id
        current[key] = entry
    return current


def evidence_sources_for_export(stored: dict | None) -> dict[str, Any]:
    sources = get_evidence_sources(stored)
    return {
        "categories": [
            {
                "key": cat["key"],
                "label": cat["label"],
                "composite_ids": cat["composite_ids"],
                "entry": sources.get(cat["key"]),
            }
            for cat in EVIDENCE_SOURCE_CATEGORIES
        ],
        "configured_count": len(sources),
    }
