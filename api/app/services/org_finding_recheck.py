"""Verify org-scoped findings (GitHub/GitLab) by re-syncing source control."""
from __future__ import annotations

import uuid
from typing import Any

import structlog
from sqlalchemy.orm import Session

from app.checks._identity_helpers import _providers_of_type, _source_label
from app.models import Finding
from app.services.fast_recheck.common import unchanged
from app.services.github_sync import sync_github_provider
from app.services.gitlab_sync import sync_gitlab_provider

log = structlog.get_logger()


def _is_org_source_control_finding(finding: Finding) -> bool:
    return finding.account_id is None and (
        finding.check_id.startswith("github.") or finding.check_id.startswith("gitlab.")
    )


def _provider_type_for_check(check_id: str) -> str | None:
    if check_id.startswith("github."):
        return "github"
    if check_id.startswith("gitlab."):
        return "gitlab"
    return None


def _matching_providers(db: Session, finding: Finding) -> list:
    provider_type = _provider_type_for_check(finding.check_id)
    if not provider_type:
        return []
    providers = _providers_of_type(db, finding.org_id, provider_type)
    evidence = finding.evidence if isinstance(finding.evidence, dict) else {}
    source = (evidence.get("source") or "").strip()
    if not source:
        return providers
    matched = [p for p in providers if _source_label(p) == source]
    return matched or providers


def try_org_finding_recheck(
    db: Session,
    *,
    finding: Finding,
    actor: str,
) -> dict[str, Any] | None:
    """Re-sync source control and re-run checks for org-scoped git findings.

    Returns None when the finding is not org-scoped source control (caller uses AWS path).
    """
    if not _is_org_source_control_finding(finding):
        return None

    providers = _matching_providers(db, finding)
    if not providers:
        return unchanged(error="No connected source-control integration for this finding")

    provider_type = _provider_type_for_check(finding.check_id)
    finding_id = finding.id
    try:
        for provider in providers:
            if provider_type == "github":
                sync_github_provider(db, provider)
            else:
                sync_gitlab_provider(db, provider)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        log.warning(
            "finding.org_recheck_failed",
            finding_id=str(finding_id),
            check_id=finding.check_id,
            error=str(exc),
        )
        return unchanged(error=str(exc)[:300])

    refreshed = db.get(Finding, finding_id)
    if refreshed and refreshed.status == "resolved":
        return {
            "queued": False,
            "checked": True,
            "resolved": True,
            "finding_id": str(finding_id),
            "check_id": finding.check_id,
        }

    return unchanged(reason="resource_still_failing")
