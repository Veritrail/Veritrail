"""Aggregate identity access-review posture for evidence packs."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.finding import Finding
from app.models.github import IdentityProvider, IdentityUser

DORMANT_DAYS = 90
_IDENTITY_PROVIDER_TYPES = ("entra_id", "google_workspace", "github", "gitlab", "okta")
_ADMIN_UNREVIEWED_CHECKS = frozenset({
    "entra.admin.unreviewed",
    "okta.admin.unreviewed",
    "github.org.admin_unreviewed",
    "google_workspace.admin.unreviewed",
})


def _is_dormant(user: IdentityUser, cutoff: datetime) -> bool:
    if user.status in {"inactive", "dormant"}:
        return True
    last = user.last_active_at
    return last is None or last < cutoff


def build_access_review_summary(db: Session, org_id: uuid.UUID) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    dormant_cutoff = now - timedelta(days=DORMANT_DAYS)

    providers = db.scalars(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type.in_(_IDENTITY_PROVIDER_TYPES),
        )
    ).all()

    provider_rows: list[dict[str, Any]] = []
    total_users = 0
    dormant_users = 0
    mfa_gaps = 0

    for provider in providers:
        users = db.scalars(
            select(IdentityUser).where(
                IdentityUser.provider_id == provider.id,
                IdentityUser.status == "active",
            )
        ).all()
        prov_dormant = sum(1 for u in users if _is_dormant(u, dormant_cutoff))
        prov_mfa_gaps = sum(1 for u in users if u.mfa_enabled is False)
        total_users += len(users)
        dormant_users += prov_dormant
        mfa_gaps += prov_mfa_gaps
        provider_rows.append(
            {
                "type": provider.type,
                "status": provider.status,
                "last_synced_at": provider.last_synced_at.isoformat() if provider.last_synced_at else None,
                "users_total": len(users),
                "users_dormant_or_inactive": prov_dormant,
                "users_without_mfa": prov_mfa_gaps,
            }
        )

    admin_findings = db.scalars(
        select(Finding).where(
            Finding.org_id == org_id,
            Finding.status == "open",
            Finding.check_id.in_(_ADMIN_UNREVIEWED_CHECKS),
        )
    ).all()
    admin_unreviewed = [
        {
            "check_id": f.check_id,
            "title": f.title,
            "resource_arn": f.resource_arn,
            "severity": f.severity,
        }
        for f in admin_findings
    ]

    open_identity_findings = db.scalar(
        select(func.count())
        .select_from(Finding)
        .where(
            Finding.org_id == org_id,
            Finding.status == "open",
            Finding.check_id.like("entra.%")
            | Finding.check_id.like("okta.%")
            | Finding.check_id.like("google_workspace.%")
            | Finding.check_id.like("github.org.%")
            | Finding.check_id.like("gitlab.org.%")
            | Finding.check_id.like("identity_center.%"),
        )
    ) or 0

    return {
        "generated_at": now.isoformat(),
        "dormant_threshold_days": DORMANT_DAYS,
        "connected_providers": len(providers),
        "providers": provider_rows,
        "users_total": total_users,
        "users_dormant_or_inactive": dormant_users,
        "users_without_mfa": mfa_gaps,
        "admin_unreviewed_count": len(admin_unreviewed),
        "admin_unreviewed": admin_unreviewed,
        "open_identity_findings": open_identity_findings,
    }
