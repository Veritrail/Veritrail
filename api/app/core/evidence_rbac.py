"""Granular evidence roles on org membership (Phase 6).

| evidence_role   | Upload | Review | Read                         |
|-----------------|--------|--------|------------------------------|
| contributor     | yes    | no     | yes (org scope)              |
| reviewer        | yes    | yes    | yes (org scope)              |
| auditor-viewer  | no     | no     | yes (pack scope: not rejected) |
"""
from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.rbac import normalize_role
from app.models.evidence_artifact import EvidenceArtifact

EVIDENCE_ROLES = frozenset({"contributor", "reviewer", "auditor-viewer"})


def default_evidence_role_for_org_role(org_role: str | None) -> str:
    r = normalize_role(org_role)
    if r in ("owner", "admin"):
        return "reviewer"
    if r == "editor":
        return "contributor"
    return "auditor-viewer"


def normalize_evidence_role(role: str | None, *, fallback_org_role: str | None = None) -> str:
    if role and role in EVIDENCE_ROLES:
        return role
    return default_evidence_role_for_org_role(fallback_org_role)


def membership_evidence_role(
    db: Session,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    *,
    fallback_org_role: str | None = None,
) -> str:
    from app.services.org_membership import get_membership

    membership = get_membership(db, user_id, org_id)
    if membership:
        return normalize_evidence_role(
            membership.evidence_role,
            fallback_org_role=fallback_org_role or membership.role,
        )
    return default_evidence_role_for_org_role(fallback_org_role)


def can_upload_evidence(evidence_role: str) -> bool:
    return evidence_role in ("contributor", "reviewer")


def can_delete_evidence(evidence_role: str) -> bool:
    return evidence_role in ("contributor", "reviewer")


def can_review_evidence(evidence_role: str) -> bool:
    return evidence_role == "reviewer"


def can_comment_evidence(evidence_role: str) -> bool:
    return evidence_role in ("contributor", "reviewer")


def is_auditor_viewer(evidence_role: str) -> bool:
    return evidence_role == "auditor-viewer"


def evidence_in_pack_scope(row: EvidenceArtifact) -> bool:
    """Artifacts included in audit packs (non-rejected external evidence)."""
    return row.status != "rejected"


def require_evidence_upload(db: Session, user_id: uuid.UUID, org_id: uuid.UUID, *, org_role: str) -> str:
    role = membership_evidence_role(db, user_id, org_id, fallback_org_role=org_role)
    if not can_upload_evidence(role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "evidence upload not permitted for your role")
    return role


def require_evidence_delete(db: Session, user_id: uuid.UUID, org_id: uuid.UUID, *, org_role: str) -> str:
    role = membership_evidence_role(db, user_id, org_id, fallback_org_role=org_role)
    if not can_delete_evidence(role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "evidence delete not permitted for your role")
    return role


def require_evidence_review(db: Session, user_id: uuid.UUID, org_id: uuid.UUID, *, org_role: str) -> str:
    role = membership_evidence_role(db, user_id, org_id, fallback_org_role=org_role)
    if not can_review_evidence(role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "evidence review not permitted for your role")
    return role


def require_evidence_comment(db: Session, user_id: uuid.UUID, org_id: uuid.UUID, *, org_role: str) -> str:
    role = membership_evidence_role(db, user_id, org_id, fallback_org_role=org_role)
    if not can_comment_evidence(role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "evidence comments not permitted for your role")
    return role


def assert_evidence_readable(row: EvidenceArtifact, evidence_role: str) -> None:
    if is_auditor_viewer(evidence_role) and not evidence_in_pack_scope(row):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "evidence not found")
