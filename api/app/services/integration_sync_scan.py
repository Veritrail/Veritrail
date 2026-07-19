"""Run identity integration checks (Entra/Google Workspace) on sync.

These are org-level compliance domains — not tied to any cloud account. Checks
run when an identity provider syncs and persist findings org-scoped
(``account_id=NULL``), mirroring the source-control decoupling.
"""
from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.checks.persist import persist_org_findings
from app.checks.registry import integration_sync_checks_for

# IdentityProvider.type values mapped to check-id prefixes.
_PROVIDER_TYPE_TO_CHECK_PREFIX: dict[str, str] = {
    "entra_id": "entra",
    "google_workspace": "google_workspace",
}


def check_prefix_for_provider_type(provider_type: str) -> str:
    """Map IdentityProvider.type to the check-id prefix used in registry."""
    return _PROVIDER_TYPE_TO_CHECK_PREFIX.get(provider_type, provider_type)


def resolve_integration_sync_findings_on_disconnect(
    db: Session, org_id: uuid.UUID, provider_type: str
) -> int:
    """Resolve open org-scoped findings for a disconnected identity provider.

    Mirrors ``persist_org_findings`` auto-resolve on sync — when the provider
    is removed, its check prefix should no longer contribute to grading or
    identity-scope findings lists.
    """
    prefix_type = check_prefix_for_provider_type(provider_type)
    check_ids_run = {mod.CHECK_ID for mod in integration_sync_checks_for(prefix_type)}
    if not check_ids_run:
        return 0
    _, resolved = persist_org_findings(
        db,
        org_id=org_id,
        drafts=[],
        check_ids_run=check_ids_run,
    )
    return resolved


def run_integration_checks(db: Session, org_id: uuid.UUID, provider_type: str) -> dict[str, int]:
    """Run identity integration checks for one provider and persist org-scoped.

    ``provider_type`` is IdentityProvider.type (``entra_id``,
    ``google_workspace``). Returns {"opened", "resolved", "checks_run"}.
    Caller commits.
    """
    prefix_type = check_prefix_for_provider_type(provider_type)
    modules = integration_sync_checks_for(prefix_type)
    drafts = []
    check_ids_run: set[str] = set()
    for mod in modules:
        check_ids_run.add(mod.CHECK_ID)
        # Checks resolve providers by org via _providers_of_type(scope=org_id).
        drafts.extend(mod.run(db, org_id))

    opened, resolved = persist_org_findings(
        db,
        org_id=org_id,
        drafts=drafts,
        check_ids_run=check_ids_run,
    )
    return {"opened": opened, "resolved": resolved, "checks_run": len(check_ids_run)}
