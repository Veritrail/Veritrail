from __future__ import annotations

from sqlalchemy.orm import Session

from app.checks._github_security_helpers import run_inactive_security_feature
from app.checks.base import FindingDraft

CHECK_ID = "github.repo.code_scanning_inactive"


def run(db: Session, account_id) -> list[FindingDraft]:
    return run_inactive_security_feature(db, account_id, "code_scanning", CHECK_ID)
