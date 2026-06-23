"""Plan tiers — single source of truth for per-plan entitlements.

Today the only enforced entitlement is the connected-account cap. Scan cadence
is intentionally NOT gated by plan (continuous/daily scanning is the core value
prop — we gate on accounts + features instead). Billing is not wired yet: set
`org.plan` manually; enforcement works regardless. Stripe flips the field later.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PlanTier:
    slug: str
    label: str
    max_accounts: int | None  # None = unlimited


PLAN_TIERS: dict[str, PlanTier] = {
    "trial": PlanTier("trial", "Trial", 1),
    "starter": PlanTier("starter", "Starter", 3),
    "growth": PlanTier("growth", "Growth", 10),
    "scale": PlanTier("scale", "Scale", 25),
    "enterprise": PlanTier("enterprise", "Enterprise", None),
}

_DEFAULT = PLAN_TIERS["trial"]
# Legacy slugs that predate the tier table map onto the closest current tier.
_LEGACY_ALIASES = {"free": "trial", "paid": "growth"}


def get_plan(plan: str | None) -> PlanTier:
    if not plan:
        return _DEFAULT
    if plan in PLAN_TIERS:
        return PLAN_TIERS[plan]
    aliased = _LEGACY_ALIASES.get(plan)
    return PLAN_TIERS[aliased] if aliased else _DEFAULT


def plan_account_limit(plan: str | None) -> int | None:
    """Max connected accounts for a plan; None = unlimited."""
    return get_plan(plan).max_accounts


def is_account_limit_reached(plan: str | None, current_count: int) -> bool:
    limit = plan_account_limit(plan)
    return limit is not None and current_count >= limit
