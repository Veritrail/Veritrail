from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.checks._identity_helpers import _providers_of_type, _source_label
from app.models.github import IdentityUser

CHECK_ID = "github.org.admin_unreviewed"


def run(db: Session, account_id) -> list[FindingDraft]:
    out: list[FindingDraft] = []
    for provider in _providers_of_type(db, account_id, "github"):
        source = _source_label(provider)
        users = db.scalars(
            select(IdentityUser).where(
                IdentityUser.provider_id == provider.id,
                IdentityUser.status == "active",
            )
        ).all()
        for u in users:
            roles = u.roles_json or {}
            org_role = roles.get("org_role")
            if org_role != "admin" and not roles.get("site_admin"):
                continue
            out.append(
                FindingDraft(
                    check_id=CHECK_ID,
                    resource_arn=f"github://{source}/{u.external_id}",
                    title=f"GitHub org admin `{roles.get('login') or u.external_id}` requires access review",
                    severity="high",
                    risk_score=score("high", admin=True),
                    evidence={
                        "provider_type": "github",
                        "org": source,
                        "login": roles.get("login"),
                        "org_role": org_role,
                        "site_admin": roles.get("site_admin"),
                    },
                )
            )
    return out
