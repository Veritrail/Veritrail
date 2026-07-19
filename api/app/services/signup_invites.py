"""Unified signup invite consumption (team invite vs new-workspace invite)."""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.org_team import OrgInvite
from app.services.org_invites import consume_invite_for_signup
from app.services.workspace_creation_invites import (
    consume_workspace_creation_invite_for_signup,
    is_workspace_creation_invite_token,
)


def consume_signup_invite(
    db: Session,
    invite_token: str,
    email: str,
    *,
    org_name: str = "",
) -> tuple:
    """Return (org, role, workspace_invite) for password or SSO signup."""
    if is_workspace_creation_invite_token(db, invite_token):
        org, role, invite = consume_workspace_creation_invite_for_signup(
            db, invite_token, email, org_name=org_name
        )
        return org, role, invite
    if db.scalar(
        select(OrgInvite.id).where(OrgInvite.token == invite_token, OrgInvite.status == "pending")
    ):
        org, role = consume_invite_for_signup(db, invite_token, email)
        return org, role, None
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite not found or already used")
