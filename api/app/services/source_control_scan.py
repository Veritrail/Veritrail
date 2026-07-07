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

from app.checks.persist import persist_org_findings
from app.checks.registry import INTEGRATION_SYNC_PREFIXES, source_control_checks_for
from app.models import Finding


def org_source_control_condition():
    """SQLAlchemy predicate for org-level source-control findings (github.*/
    gitlab.*, account_id NULL)."""
    return and_(
        Finding.account_id.is_(None),
        or_(Finding.check_id.like("github.%"), Finding.check_id.like("gitlab.%")),
    )


def org_integration_condition():
    """SQLAlchemy predicate for org-level identity integration findings."""
    return and_(
        Finding.account_id.is_(None),
        or_(*(Finding.check_id.like(f"{prefix}%") for prefix in INTEGRATION_SYNC_PREFIXES)),
    )


def with_source_control_for_audit(account_condition):
    """OR an account-scoped condition with org-level source-control + identity
    integration findings — for COMPLIANCE/AUDIT contexts ONLY (evidence pack,
    control grading).

    Do NOT use in operational Findings/export/account views: these org-level
    domains must not surface under cloud account selection.
    """
    return or_(account_condition, org_source_control_condition(), org_integration_condition())


def resolve_source_control_findings_on_disconnect(
    db: Session, org_id: uuid.UUID, provider_type: str
) -> int:
    """Resolve open org-scoped findings for a disconnected git provider."""
    check_ids_run = {mod.CHECK_ID for mod in source_control_checks_for(provider_type)}
    if not check_ids_run:
        return 0
    _, resolved = persist_org_findings(
        db,
        org_id=org_id,
        drafts=[],
        check_ids_run=check_ids_run,
    )
    return resolved


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

    # persist_org_findings is org-isolated (org_id + all cloud-scope columns
    # NULL). Must NOT use persist_findings(account_id=None): that lookup filters
    # only by account_id with no org_id, so one org's git sync would mutate and
    # auto-resolve every other org's source-control findings.
    opened, resolved = persist_org_findings(
        db,
        org_id=org_id,
        drafts=drafts,
        check_ids_run=check_ids_run,
    )
    return {"opened": opened, "resolved": resolved, "checks_run": len(check_ids_run)}
