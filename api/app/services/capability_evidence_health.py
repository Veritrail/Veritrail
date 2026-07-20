"""Capability-level integration health (hardening Phase B).

Connection health (auth works) is separate from evidence health (authoritative
capability syncs are fresh and complete). Health checks must not call expensive
vendor endpoints — they derive evidence status from stored sync records.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.github import IdentityProvider, Repo
from app.services.capability_limitations import serialize_limitations
from app.services.technical_capability import FRESHNESS_POLICY_DAYS, parse_iso

EvidenceStatus = Literal["ok", "degraded", "stale", "unknown", "unavailable"]


def _provider_type(provider: IdentityProvider) -> str:
    return (provider.type or "").strip().lower()


def _scan_ts_from_features(features: dict[str, Any]) -> tuple[datetime | None, list[str], list[str]]:
    """Return (latest successful scan, affected capabilities, limitations)."""
    latest: datetime | None = None
    affected: list[str] = []
    limitations: list[str] = []
    cap_ev = features.get("capability_evidence")
    if not isinstance(cap_ev, dict):
        return None, [], []
    for cap_id, block in cap_ev.items():
        if not isinstance(block, dict):
            continue
        coll = block.get("collection") if isinstance(block.get("collection"), dict) else {}
        coll_status = coll.get("collection_status") or "complete"
        lims = [str(x) for x in (block.get("limitations") or []) if x]
        for lim in lims:
            if lim not in limitations:
                limitations.append(lim)
        if coll_status != "complete" or lims:
            if cap_id not in affected:
                affected.append(str(cap_id))
        ts = parse_iso(block.get("last_successful_scan_at"))
        if ts is None:
            continue
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        if latest is None or ts > latest:
            latest = ts
    return latest, affected, limitations


def github_evidence_health(
    db: Session,
    provider: IdentityProvider,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Derive GitHub evidence health from stored repo security_features."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    connection_status = (provider.status or "unknown").lower()
    if connection_status not in ("connected", "error", "pending"):
        connection_status = "connected" if connection_status == "active" else "unknown"

    repos = db.scalars(
        select(Repo).where(Repo.provider_id == provider.id).limit(500)
    ).all()

    latest: datetime | None = None
    affected: list[str] = []
    limitations: list[str] = []
    for repo in repos:
        features = repo.security_features if isinstance(repo.security_features, dict) else {}
        ts, caps, lims = _scan_ts_from_features(features)
        if ts and (latest is None or ts > latest):
            latest = ts
        for c in caps:
            if c not in affected:
                affected.append(c)
        for lim in lims:
            if lim not in limitations:
                limitations.append(lim)

    # Freshness: use the strictest SDLC window among dependency/source/secret (14d).
    window_days = max(
        FRESHNESS_POLICY_DAYS.get("dependency_scanning", 14),
        FRESHNESS_POLICY_DAYS.get("source_code_scanning", 14),
        FRESHNESS_POLICY_DAYS.get("secret_scanning", 14),
    )

    evidence_status: EvidenceStatus
    if connection_status != "connected":
        evidence_status = "unavailable"
    elif not repos:
        evidence_status = "unknown"
    elif any(
        lim in limitations
        for lim in ("permission_denied", "collection_error")
    ) or any(l.startswith("collection_limited_by_") for l in limitations):
        evidence_status = "degraded"
    elif latest is None:
        evidence_status = "unknown"
    elif (now - latest).days > window_days:
        evidence_status = "stale"
        if "dependency_scanning" not in affected:
            affected.append("dependency_scanning")
    else:
        evidence_status = "ok"

    return {
        "provider": "github",
        "connection_status": connection_status,
        "evidence_status": evidence_status,
        "last_connection_check_at": None,  # filled by health check callers when they ping /user
        "last_successful_evidence_at": latest.isoformat() if latest else None,
        "affected_capabilities": affected[:12],
        "limitations": limitations[:12],
        "limitations_detail": serialize_limitations(limitations[:12]),
        "needs_attention": evidence_status in ("degraded", "stale", "unknown")
        and connection_status == "connected",
    }


def capability_evidence_health_for_org(
    db: Session,
    org_id: uuid.UUID,
    *,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Evidence health rows for connected providers that participate in capability lanes."""
    providers = db.scalars(
        select(IdentityProvider).where(IdentityProvider.org_id == org_id)
    ).all()
    rows: list[dict[str, Any]] = []
    for provider in providers:
        ptype = _provider_type(provider)
        if ptype in ("github", "github_app"):
            rows.append(github_evidence_health(db, provider, now=now))
        # Additional providers can be derived similarly in later phases.
    return rows
