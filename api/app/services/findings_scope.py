"""Shared findings list/export scope filters (cloud accounts vs source control)."""
from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import or_

from app.models import Finding

ORG_PROVIDER_VALUES = frozenset({"github", "gitlab", "source_control", "all_cloud"})


def validate_findings_scope_params(
    *,
    provider: str | None,
    account_id: uuid.UUID | None,
    gcp_project_id: uuid.UUID | None,
    azure_subscription_id: uuid.UUID | None,
) -> None:
    if provider is not None and provider not in ORG_PROVIDER_VALUES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"provider must be one of {sorted(ORG_PROVIDER_VALUES)}",
        )
    if provider in ORG_PROVIDER_VALUES and any(
        x is not None for x in (account_id, gcp_project_id, azure_subscription_id)
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "provider scope cannot be combined with cloud account filters",
        )


def _apply_cloud_account_scope(
    q,
    *,
    account_id: uuid.UUID | None = None,
    gcp_project_id: uuid.UUID | None = None,
    azure_subscription_id: uuid.UUID | None = None,
):
    # Cloud scope only. Source-control findings are org-level and NOT tied to a
    # cloud account — they have their own provider scope on Findings.
    if account_id is not None:
        return q.where(Finding.account_id == account_id)
    if gcp_project_id is not None:
        return q.where(Finding.gcp_project_id == gcp_project_id)
    if azure_subscription_id is not None:
        return q.where(Finding.azure_subscription_id == azure_subscription_id)
    return q


def apply_findings_scope(
    q,
    *,
    provider: str | None,
    account_id: uuid.UUID | None,
    gcp_project_id: uuid.UUID | None,
    azure_subscription_id: uuid.UUID | None,
):
    """Apply org-level provider scope OR single cloud account scope — never both."""
    validate_findings_scope_params(
        provider=provider,
        account_id=account_id,
        gcp_project_id=gcp_project_id,
        azure_subscription_id=azure_subscription_id,
    )
    if provider == "github":
        return q.where(
            Finding.account_id.is_(None),
            Finding.check_id.like("github.%"),
        )
    if provider == "gitlab":
        return q.where(
            Finding.account_id.is_(None),
            Finding.check_id.like("gitlab.%"),
        )
    if provider == "source_control":
        return q.where(
            Finding.account_id.is_(None),
            or_(
                Finding.check_id.like("github.%"),
                Finding.check_id.like("gitlab.%"),
            ),
        )
    if provider == "all_cloud":
        return q.where(
            or_(
                Finding.account_id.isnot(None),
                Finding.gcp_project_id.isnot(None),
                Finding.azure_subscription_id.isnot(None),
            )
        )
    return _apply_cloud_account_scope(
        q,
        account_id=account_id,
        gcp_project_id=gcp_project_id,
        azure_subscription_id=azure_subscription_id,
    )
