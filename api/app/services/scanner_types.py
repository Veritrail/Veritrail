"""Shared types for vulnerability scanner import."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

_SEVERITY_MAP = {
    "critical": "critical",
    "high": "high",
    "medium": "medium",
    "low": "low",
    "info": "info",
    "informational": "info",
}


@dataclass
class ImportedScannerFinding:
    external_id: str
    title: str
    severity: str
    resource_label: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


def normalize_severity(raw: str | None) -> str:
    key = (raw or "medium").strip().lower()
    return _SEVERITY_MAP.get(key, "medium")
