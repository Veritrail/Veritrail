from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class FindingDraft:
    check_id: str
    resource_arn: str
    title: str
    severity: str  # info|low|medium|high|critical
    risk_score: int
    evidence: dict[str, Any] = field(default_factory=dict)


# info = signal-only (not required by SOC2/CIS); no compliance penalty.
SEVERITY_BASE = {"info": 5, "low": 20, "medium": 40, "high": 70, "critical": 90}


def score(severity: str, *, age_days: int | None = None, admin: bool = False) -> int:
    base = SEVERITY_BASE.get(severity, 30)
    if admin:
        base = min(100, base + 15)
    if age_days is not None:
        # +1 per 30 days, capped at +20
        base = min(100, base + min(20, age_days // 30))
    return base
