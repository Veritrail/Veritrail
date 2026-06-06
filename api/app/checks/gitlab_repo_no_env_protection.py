"""Check: GitLab project has protected environments with no required approvals."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.checks._identity_helpers import run_no_env_protection
from app.checks.base import FindingDraft

CHECK_ID = "gitlab.repo.no_env_protection"


def run(db: Session, account_id) -> list[FindingDraft]:
    return run_no_env_protection(db, account_id, "gitlab", CHECK_ID)
