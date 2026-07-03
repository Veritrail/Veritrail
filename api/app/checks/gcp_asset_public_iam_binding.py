from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.gcp_project import GcpCloudAsset, GcpProject

CHECK_ID = "gcp.asset.public_iam_binding"

# Public *invocation* endpoints (Cloud Functions / Cloud Run with allUsers
# invoker) are handled by the sibling check gcp.asset.public_invoker at medium
# severity — the standard GCP pattern for public HTTP endpoints. This check
# covers everything else (buckets, datasets, unknown types): public IAM on a
# data-holding asset is direct data exposure — severity depends on the bound role.
INVOCATION_ASSET_TYPES = (
    "cloudfunctions.googleapis.com/",
    "run.googleapis.com/",
)

# Privileged public bindings — editor/owner/admin grant write or broad control.
_PRIVILEGED_ROLE_MARKERS = (
    "roles/editor",
    "roles/owner",
    "roles/iam.serviceaccountuser",
    "roles/iam.serviceaccounttokencreator",
    "/editor",
    "/owner",
    "/admin",
)

# Read-only public exposure — still a finding, but lower than editor-level grants.
_READ_ONLY_ROLE_MARKERS = (
    "objectviewer",
    "legacybucketreader",
    "roles/viewer",
)


def _role_is_privileged(role: str) -> bool:
    lowered = role.lower()
    return any(marker in lowered for marker in _PRIVILEGED_ROLE_MARKERS)


def _role_is_read_only(role: str) -> bool:
    lowered = role.lower()
    return any(marker in lowered for marker in _READ_ONLY_ROLE_MARKERS)


def _severity_for_roles(roles: list[str]) -> tuple[str, str]:
    normalized = [r for r in roles if r]
    for role in normalized:
        if _role_is_privileged(role):
            return "high", f"public IAM binding with privileged role {role}"
    for role in normalized:
        if _role_is_read_only(role):
            return "medium", f"public IAM binding with read-only role {role}"
    return "high", "public IAM binding on a data-holding asset"


def run(db: Session, gcp_project_id) -> list[FindingDraft]:
    project = db.get(GcpProject, gcp_project_id)
    if not project:
        return []

    exposed = db.scalars(
        select(GcpCloudAsset).where(
            GcpCloudAsset.gcp_project_id == gcp_project_id,
            GcpCloudAsset.has_public_iam == True,  # noqa: E712
        )
    ).all()

    drafts: list[FindingDraft] = []
    for asset in exposed:
        if (asset.asset_type or "").startswith(INVOCATION_ASSET_TYPES):
            continue  # covered by gcp.asset.public_invoker at medium
        short_name = asset.asset_name.rsplit("/", 1)[-1]
        roles = list(asset.public_iam_roles or [])
        severity, basis = _severity_for_roles(roles)
        drafts.append(
            FindingDraft(
                check_id=CHECK_ID,
                resource_arn=f"gcp://asset/{project.project_id}/{short_name}",
                title=f"GCP asset {short_name} has a public IAM binding",
                severity=severity,
                risk_score=score(severity),
                evidence={
                    "project_id": project.project_id,
                    "asset_name": asset.asset_name,
                    "asset_type": asset.asset_type,
                    "public_iam_roles": roles,
                    "severity_basis": basis,
                },
            )
        )
    return drafts
