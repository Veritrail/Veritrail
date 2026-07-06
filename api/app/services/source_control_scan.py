"""Run source-control (GitHub/GitLab) checks on git sync.

Source control is an org-level compliance domain — it is not tied to any cloud
account. These checks therefore run when a git provider syncs (not during a
cloud-account scan) and persist findings org-scoped (``account_id=NULL``). This
keeps Secure SDLC a field of its own and lets it update on ``git sync`` even for
orgs that have no cloud account connected.
"""
from __future__ import annotations

import uuid

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.checks.persist import persist_findings
from app.checks.registry import source_control_checks_for
from app.models import Finding


def org_source_control_condition():
    """SQLAlchemy predicate for org-level source-control findings.

    Source-control findings (github.*/gitlab.*) are org-scoped — account_id is
    NULL — so any account-scoped finding query must OR this in to keep Secure
    SDLC findings visible in per-account views and audit deliverables.
    """
    return and_(
        Finding.account_id.is_(None),
        or_(Finding.check_id.like("github.%"), Finding.check_id.like("gitlab.%")),
    )


def with_org_source_control(account_condition):
    """OR an account-scoped condition with org-level source-control findings."""
    return or_(account_condition, org_source_control_condition())


def run_source_control_checks(db: Session, org_id: uuid.UUID, provider_type: str) -> dict[str, int]:
    """Run the source-control checks for one provider type and persist org-scoped.

    Returns {"opened": int, "resolved": int, "checks_run": int}. Caller commits.
    """
    modules = source_control_checks_for(provider_type)
    drafts = []
    check_ids_run: set[str] = set()
    for mod in modules:
        check_ids_run.add(mod.CHECK_ID)
        # Checks resolve providers by org via _providers_of_type(scope=org_id).
        drafts.extend(mod.run(db, org_id))

    opened, resolved = persist_findings(
        db,
        org_id=org_id,
        account_id=None,
        drafts=drafts,
        check_ids_run=check_ids_run,
    )
    return {"opened": opened, "resolved": resolved, "checks_run": len(check_ids_run)}
