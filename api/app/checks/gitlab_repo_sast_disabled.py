from __future__ import annotations

from sqlalchemy.orm import Session

from app.checks._gitlab_security_helpers import run_missing_security_feature
from app.checks.base import FindingDraft

CHECK_ID = "gitlab.repo.sast_disabled"


def run(db: Session, account_id) -> list[FindingDraft]:
    return run_missing_security_feature(db, account_id, "sast", CHECK_ID)
