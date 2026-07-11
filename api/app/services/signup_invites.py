"""Unified signup invite consumption (team invite vs new-workspace invite)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.org_team import OrgInvite
from app.services.org_invites import consume_invite_for_signup
from app.services.workspace_creation_invites import consume_workspace_creation_invite_for_signup


def consume_signup_invite(
    db: Session,
    invite_token: str,
    email: str,
    *,
    org_name: str = "",
) -> tuple:
    """Return (org, role) for password or SSO signup."""
    if db.scalar(
        select(OrgInvite.id).where(OrgInvite.token == invite_token, OrgInvite.status == "pending")
    ):
        return consume_invite_for_signup(db, invite_token, email)
    return consume_workspace_creation_invite_for_signup(
        db, invite_token, email, org_name=org_name
    )
