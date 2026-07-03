from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.checks._identity_helpers import _providers_of_type, _source_label
from app.models.github import IdentityUser

CHECK_ID = "okta.admin.unreviewed"


def run(db: Session, account_id) -> list[FindingDraft]:
    out: list[FindingDraft] = []
    for provider in _providers_of_type(db, account_id, "okta"):
        source = _source_label(provider)
        admins = db.scalars(
            select(IdentityUser).where(
                IdentityUser.provider_id == provider.id,
                IdentityUser.status == "active",
            )
        ).all()
        for u in admins:
            roles = (u.roles_json or {}).get("admin_roles") or []
            if not (u.roles_json or {}).get("is_admin") and not roles:
                continue
            out.append(
                FindingDraft(
                    check_id=CHECK_ID,
                    resource_arn=f"okta://{source}/{u.external_id}",
                    title=f"Okta privileged admin `{u.email or u.external_id}` requires access review",
                    severity="high",
                    risk_score=score("high", admin=True),
                    evidence={
                        "provider_type": "okta",
                        "org_url": source,
                        "email": u.email,
                        "external_id": u.external_id,
                        "admin_roles": roles,
                    },
                )
            )
    return out
