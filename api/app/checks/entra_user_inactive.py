from __future__ import annotations

from sqlalchemy.orm import Session

from app.checks._identity_helpers import run_dormant_members

CHECK_ID = "entra.user.inactive_90d"


def run(db: Session, account_id) -> list[FindingDraft]:
    return run_dormant_members(db, account_id, "entra_id", CHECK_ID)
