import uuid
import json
import re
import hashlib
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.rbac import get_org_user, role_at_least
from app.core.evidence_rbac import (
    assert_evidence_readable,
    is_auditor_viewer,
    membership_evidence_role,
    require_evidence_comment,
    require_evidence_delete,
    require_evidence_review,
    require_evidence_upload,
)
from app.core.security import current_principal
from app.data.control_narratives import narrative_for, narrative_detail_for
from app.models import Finding, AwsAccount, EvidenceSnapshot, ScanRun
from app.models.control import Control, CheckControl
from app.models.control_attestation import ATTESTATION_STATUSES, ControlAttestation
from app.models.evidence_artifact import EVIDENCE_STATUSES, EvidenceArtifact
from app.models.evidence_artifact_comment import EvidenceArtifactComment
from app.models.org import Org, User
from app.services.org_activity import log_org_activity
from app.services.check_settings import hidden_check_ids
from app.services.check_coverage import (
    control_coverage_tier,
    extended_checks_in_list,
    tier_display_label,
    tier_for_check,
)
from app.services.check_evidence import all_evidence_classes, evidence_class_for_check
from app.services.check_frameworks import check_framework_map, framework_catalog
from app.services.cis_benchmark_coverage import cis_benchmark_coverage
from app.services.compliance_timeline import build_control_history
from app.services.composite_controls import composite_control_definitions, list_composite_controls
from app.services.control_status import compute_control_status
from app.services.evidence_artifact_storage import (
    delete_artifact,
    is_s3_storage_path,
    presigned_download_url,
    save_artifact_bytes,
    storage_backend_label,
)
from app.services.evidence_artifact_retention import default_expires_at
from app.services.evidence_artifact_safety import EvidenceUploadRejected, validate_evidence_upload
from app.services.evidence_artifact_clamav import scan_bytes as clamav_scan_bytes
from app.services.evidence_artifact_supersession import supersede_prior_accepted
from app.services.category_evidence_coverage import build_category_evidence_coverage

router = APIRouter()

FRAMEWORKS = {"soc2", "cis_aws_l1", "iso27001"}


class ControlOut(BaseModel):
    id: str
    framework: str
    control_id: str
    title: str
    description: str
    guidance: str | None
    narrative: str | None
    short_answer: str | None = None
    long_answer: str | None = None
    evidence_refs: list[str] = []
    known_gaps: list[str] = []
    check_ids: list[str]
    coverage_tier: str = "core"  # core | extended | mixed | no_data
    coverage_label: str | None = None
    extended_check_ids: list[str] = []
    check_tiers: dict[str, str] = {}
    check_evidence_classes: dict[str, str] = {}
    status: str          # pass | fail | no_data
    finding_count: int
    open_finding_ids: list[str]
    kind: str = "auto"   # auto | manual
    attestation_status: str | None = None  # manual controls: met|not_met|not_applicable|pending
    # Framework-mapping metadata (set only for the matching framework's controls).
    soc2_scope_category: str | None = None
    cis_profile_level: str | None = None
    iso_applicability: str | None = None
    iso_applicability_rationale: str | None = None


class CheckScanErrorOut(BaseModel):
    check_id: str
    error_type: str | None = None
    error: str | None = None


class CompositeControlOut(BaseModel):
    id: str
    control_id: str
    title: str
    description: str
    guidance: str | None
    soc2_criteria: list[str]
    cis_criteria: list[str] = []
    iso_criteria: list[str] = []
    check_ids: list[str]
    coverage_tier: str = "core"
    coverage_label: str | None = None
    extended_check_ids: list[str] = []
    check_tiers: dict[str, str] = {}
    check_evidence_classes: dict[str, str] = {}
    status: str
    finding_count: int
    severity_counts: dict[str, int] = {}
    open_finding_ids: list[str]
    scan_errors: list[CheckScanErrorOut] = []
    coverage_override: str | None = None
    coverage_override_detail: dict | None = None
    cross_account_coverage_detail: dict | None = None
    sdlc_insights: dict | None = None


class CheckFrameworksOut(BaseModel):
    frameworks: list[dict[str, str]]
    checks: dict[str, list[str]]
    coverage_tiers: dict[str, str] = {}
    evidence_classes: dict[str, str] = {}
    evidence_class_labels: dict[str, str] = {}
    cis_benchmark_coverage: dict | None = None


class EvidenceArtifactOut(BaseModel):
    id: str
    control_id: str | None = None
    composite_control_id: str | None = None
    check_id: str | None = None
    framework: str
    control_ref: str | None = None
    title: str
    source: str | None = None
    evidence_type: str | None = None
    period_start: str | None = None
    period_end: str | None = None
    note: str | None = None
    external_url: str | None = None
    owner: str | None = None
    status: str = "submitted"
    expires_at: str | None = None
    filename: str | None = None
    content_type: str | None = None
    size_bytes: int
    checksum_sha256: str | None = None
    review_notes: str | None = None
    reviewed_at: str | None = None
    reviewed_by_email: str | None = None
    superseded_by: str | None = None
    policy_ref: str | None = None
    suggested_mappings: list[dict] = []
    created_at: str | None = None


class EvidenceReviewIn(BaseModel):
    status: Literal["accepted", "rejected"]
    review_notes: str | None = None


class EvidenceCommentOut(BaseModel):
    id: str
    artifact_id: str
    body: str
    author_user_id: str | None = None
    author_email: str | None = None
    created_at: str


class EvidenceCommentIn(BaseModel):
    body: str


class EvidenceCoverageCategoryOut(BaseModel):
    key: str
    label: str
    composite_ids: list[str]
    primary_composite_id: str | None = None
    scan_status: str
    display_status: str
    registry_vendor: str | None = None
    accepted_artifacts: int = 0
    submitted_artifacts: int = 0
    stale_artifacts: int = 0


class EvidenceCoverageOut(BaseModel):
    framework: str
    summary: dict[str, int]
    categories: list[EvidenceCoverageCategoryOut]
    storage_backend: str


_MAX_EVIDENCE_UPLOAD_BYTES = 12 * 1024 * 1024
_TEXT_EXTENSIONS = {".txt", ".csv", ".json", ".md", ".log"}
_ALLOWED_EVIDENCE_EXTENSIONS = _TEXT_EXTENSIONS | {".pdf", ".png", ".jpg", ".jpeg", ".webp"}


def _safe_filename(name: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(name or "evidence").name).strip(".-")
    return clean[:180] or "evidence"


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "dates must use YYYY-MM-DD")


def _extract_evidence_text(filename: str, content_type: str | None, raw: bytes) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix == ".json" or content_type == "application/json":
        try:
            parsed = json.loads(raw.decode("utf-8"))
            return json.dumps(parsed, indent=2, sort_keys=True)[:30_000]
        except Exception:
            return raw.decode("utf-8", errors="ignore")[:30_000]
    if suffix in _TEXT_EXTENSIONS or (content_type or "").startswith("text/"):
        return raw.decode("utf-8", errors="ignore")[:30_000]
    return ""


def _keyword_suggestions(text: str, controls: list[Control]) -> list[dict]:
    haystack = text.lower()
    buckets = [
        (
            ("vulnerability", "inspector", "tenable", "qualys", "wiz", "snyk", "cve", "scanner", "container", "ecr"),
            ("vulnerability", "technical vulnerabilities", "security monitoring", "system operations"),
            "Looks like vulnerability-management evidence.",
        ),
        (
            ("access review", "mfa", "inactive user", "privileged", "iam", "permission", "identity", "user access"),
            ("access", "logical access", "identity", "privileged"),
            "Looks like access-review or identity evidence.",
        ),
        (
            ("change", "pull request", "merge request", "approval", "deployment", "release", "branch protection"),
            ("change", "system changes", "change management"),
            "Looks like change-management evidence.",
        ),
        (
            ("backup", "restore", "recovery", "retention", "resilience", "snapshot"),
            ("backup", "recovery", "availability", "resilience"),
            "Looks like backup or recovery evidence.",
        ),
        (
            ("encryption", "kms", "secret", "public access", "data protection", "classification"),
            ("encryption", "data", "cryptography", "secret"),
            "Looks like data-protection evidence.",
        ),
    ]
    out: list[dict] = []
    seen: set[str] = set()
    for triggers, control_terms, reason in buckets:
        if not any(token in haystack for token in triggers):
            continue
        for ctrl in controls:
            searchable = f"{ctrl.control_id} {ctrl.title} {ctrl.description} {ctrl.guidance or ''}".lower()
            if any(term in searchable for term in control_terms) and str(ctrl.id) not in seen:
                seen.add(str(ctrl.id))
                out.append(
                    {
                        "control_id": str(ctrl.id),
                        "control_ref": ctrl.control_id,
                        "title": ctrl.title,
                        "reason": reason,
                    }
                )
                if len(out) >= 5:
                    return out
    return out


def _composite_definition(composite_id: str) -> dict | None:
    for entry in composite_control_definitions():
        if entry.get("id") == composite_id:
            return entry
    return None


def _reviewer_emails(db: Session, rows: list[EvidenceArtifact]) -> dict[uuid.UUID, str | None]:
    reviewer_ids = {row.reviewed_by for row in rows if row.reviewed_by}
    if not reviewer_ids:
        return {}
    users = db.scalars(select(User).where(User.id.in_(reviewer_ids))).all()
    return {user.id: user.email for user in users}


def _artifact_out(row: EvidenceArtifact, *, reviewer_email: str | None = None) -> EvidenceArtifactOut:
    return EvidenceArtifactOut(
        id=str(row.id),
        control_id=str(row.control_id) if row.control_id else None,
        composite_control_id=row.composite_control_id,
        check_id=row.check_id,
        framework=row.framework,
        control_ref=row.control_ref,
        title=row.title,
        source=row.source,
        evidence_type=row.evidence_type,
        period_start=row.period_start.isoformat() if row.period_start else None,
        period_end=row.period_end.isoformat() if row.period_end else None,
        note=row.note,
        external_url=row.external_url,
        owner=row.owner,
        status=row.status or "submitted",
        expires_at=row.expires_at.isoformat() if row.expires_at else None,
        filename=row.filename,
        content_type=row.content_type,
        size_bytes=row.size_bytes,
        checksum_sha256=row.checksum_sha256,
        review_notes=row.review_notes,
        reviewed_at=row.reviewed_at.isoformat() if row.reviewed_at else None,
        reviewed_by_email=reviewer_email,
        superseded_by=str(row.superseded_by) if row.superseded_by else None,
        policy_ref=row.policy_ref,
        suggested_mappings=row.suggested_mappings or [],
        created_at=row.created_at.isoformat() if row.created_at else None,
    )


@router.get("/evidence", response_model=list[EvidenceArtifactOut])
def list_evidence_artifacts(
    framework: str | None = Query(default=None),
    control_id: str | None = Query(default=None),
    composite_control_id: str | None = Query(default=None),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org_id = uuid.UUID(p["org_id"])
    user = get_org_user(db, p)
    evidence_role = membership_evidence_role(db, user.id, org_id, fallback_org_role=user.role)
    q = select(EvidenceArtifact).where(EvidenceArtifact.org_id == org_id)
    if is_auditor_viewer(evidence_role):
        q = q.where(EvidenceArtifact.status != "rejected")
    if framework:
        q = q.where(EvidenceArtifact.framework == framework)
    if control_id:
        try:
            q = q.where(EvidenceArtifact.control_id == uuid.UUID(control_id))
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid control_id")
    if composite_control_id:
        q = q.where(EvidenceArtifact.composite_control_id == composite_control_id)
    rows = db.scalars(q.order_by(EvidenceArtifact.created_at.desc())).all()
    reviewers = _reviewer_emails(db, rows)
    return [
        _artifact_out(row, reviewer_email=reviewers.get(row.reviewed_by) if row.reviewed_by else None)
        for row in rows
    ]


class EvidenceDownloadOut(BaseModel):
    url: str
    expires_in: int


@router.get("/evidence/{artifact_id}/download")
def download_evidence_artifact(
    artifact_id: str,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    user = get_org_user(db, p)
    try:
        art_id = uuid.UUID(artifact_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid artifact_id")

    org_id = uuid.UUID(p["org_id"])
    row = db.get(EvidenceArtifact, art_id)
    if not row or row.org_id != org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "evidence not found")

    evidence_role = membership_evidence_role(db, user.id, org_id, fallback_org_role=user.role)
    assert_evidence_readable(row, evidence_role)

    if row.external_url:
        return RedirectResponse(row.external_url, status_code=status.HTTP_302_FOUND)

    if not row.storage_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no file stored for this evidence")

    log_org_activity(
        db,
        org_id=org_id,
        actor_user_id=user.id,
        actor_email=user.email,
        action="evidence.downloaded",
        target_type="control",
        target_id=row.control_ref or row.composite_control_id or row.framework,
        target_label=row.title,
        detail={"artifact_id": str(row.id), "filename": row.filename},
    )
    db.commit()

    if is_s3_storage_path(row.storage_path):
        ttl = get_settings().EVIDENCE_ARTIFACTS_DOWNLOAD_TTL_SECONDS
        try:
            url = presigned_download_url(row.storage_path, filename=row.filename, ttl_seconds=ttl)
        except Exception:
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "failed to create download URL")
        return EvidenceDownloadOut(url=url, expires_in=ttl)

    local_path = Path(get_settings().LOCAL_UPLOAD_DIR) / row.storage_path
    if not local_path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "evidence file not found")
    return FileResponse(
        local_path,
        media_type=row.content_type or "application/octet-stream",
        filename=row.filename or local_path.name,
    )


@router.get("/evidence-coverage", response_model=EvidenceCoverageOut)
def evidence_coverage_route(
    framework: str = Query(default="soc2"),
    account_id: str | None = Query(default=None),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    if framework not in FRAMEWORKS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"framework must be one of {sorted(FRAMEWORKS)}")
    org_id = uuid.UUID(p["org_id"])
    acc_id: uuid.UUID | None = None
    if account_id:
        try:
            acc_id = uuid.UUID(account_id)
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid account_id")
    payload = build_category_evidence_coverage(db, org_id=org_id, framework=framework, account_id=acc_id)
    payload["storage_backend"] = storage_backend_label()
    return payload


@router.post("/evidence", response_model=EvidenceArtifactOut)
async def upload_evidence_artifact(
    request: Request,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    user = get_org_user(db, p)
    require_evidence_upload(db, user.id, user.org_id, org_role=user.role)
    form = await request.form()
    file = form.get("file")
    has_file = file is not None and hasattr(file, "read")

    def field(name: str) -> str | None:
        value = form.get(name)
        return value if isinstance(value, str) else None

    framework = field("framework") or ""
    control_id = field("control_id")
    composite_control_id = (field("composite_control_id") or "").strip() or None
    check_id = (field("check_id") or "").strip() or None
    external_url = (field("external_url") or "").strip() or None
    owner = (field("owner") or "").strip() or None
    title = field("title")
    source = field("source")
    evidence_type = field("evidence_type")
    period_start = field("period_start")
    period_end = field("period_end")
    expires_at = field("expires_at")
    note = field("note")
    policy_ref = (field("policy_ref") or "").strip() or None

    if framework not in FRAMEWORKS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"framework must be one of {sorted(FRAMEWORKS)}")

    if not has_file and not external_url:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "evidence file or external_url is required")

    composite_def: dict | None = None
    if composite_control_id:
        composite_def = _composite_definition(composite_control_id)
        if not composite_def:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid composite_control_id")
        if check_id and check_id not in composite_def.get("checks", []):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "check_id is not mapped to this composite group")

    ctrl: Control | None = None
    ctrl_id: uuid.UUID | None = None
    if control_id:
        try:
            ctrl_id = uuid.UUID(control_id)
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid control_id")
        ctrl = db.get(Control, ctrl_id)
        if not ctrl or ctrl.framework != framework:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "control not found")

    org_id = uuid.UUID(p["org_id"])
    original_name: str | None = None
    relative_path: str | None = None
    content_type: str | None = None
    size_bytes = 0
    extracted = ""
    checksum_sha256: str | None = None

    if has_file:
        original_name = _safe_filename(getattr(file, "filename", None) or "evidence")
        raw = await file.read()
        try:
            validate_evidence_upload(original_name, raw, allowed_extensions=_ALLOWED_EVIDENCE_EXTENSIONS)
        except EvidenceUploadRejected as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
        if len(raw) > _MAX_EVIDENCE_UPLOAD_BYTES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "evidence file is too large")

        try:
            clamav_scan_bytes(raw)
        except EvidenceUploadRejected as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e

        stored_name = f"{uuid.uuid4()}-{original_name}"
        content_type = getattr(file, "content_type", None)
        try:
            relative_path = save_artifact_bytes(
                org_id=org_id,
                stored_name=stored_name,
                raw=raw,
                content_type=content_type,
            )
        except Exception as e:
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "failed to store evidence file") from e

        extracted = _extract_evidence_text(original_name, content_type, raw)
        size_bytes = len(raw)
        checksum_sha256 = hashlib.sha256(raw).hexdigest()

    elif external_url:
        checksum_sha256 = hashlib.sha256(external_url.encode("utf-8")).hexdigest()

    controls = db.scalars(select(Control).where(Control.framework == framework)).all()
    suggest_text = " ".join(
        part
        for part in [
            title or "",
            source or "",
            evidence_type or "",
            note or "",
            external_url or "",
            original_name or "",
            extracted,
        ]
        if part
    )
    suggestions = _keyword_suggestions(suggest_text, controls)

    parsed_expires = _parse_date(expires_at) or default_expires_at()

    row = EvidenceArtifact(
        org_id=org_id,
        control_id=ctrl_id,
        composite_control_id=composite_control_id,
        check_id=check_id,
        framework=framework,
        control_ref=ctrl.control_id if ctrl else None,
        title=(title or original_name or source or "External evidence").strip()[:300],
        source=(source or "").strip()[:120] or None,
        evidence_type=(evidence_type or "").strip()[:80] or None,
        period_start=_parse_date(period_start),
        period_end=_parse_date(period_end),
        note=(note or "").strip() or None,
        policy_ref=policy_ref[:200] if policy_ref else None,
        external_url=external_url[:500] if external_url else None,
        owner=owner[:200] if owner else None,
        status="submitted",
        expires_at=parsed_expires,
        filename=original_name,
        storage_path=relative_path,
        content_type=content_type,
        size_bytes=size_bytes,
        checksum_sha256=checksum_sha256,
        extracted_text=extracted or None,
        suggested_mappings=suggestions,
        created_by=user.id,
    )
    db.add(row)
    log_org_activity(
        db,
        org_id=org_id,
        actor_user_id=user.id,
        actor_email=user.email,
        action="evidence.uploaded",
        target_type="control",
        target_id=ctrl.control_id if ctrl else composite_control_id or framework,
        target_label=row.title,
        detail={
            "framework": framework,
            "control_ref": row.control_ref,
            "composite_control_id": composite_control_id,
            "filename": original_name,
            "external_url": bool(external_url),
        },
    )
    db.commit()
    db.refresh(row)
    reviewer_email = db.get(User, row.reviewed_by).email if row.reviewed_by else None
    return _artifact_out(row, reviewer_email=reviewer_email)


@router.delete("/evidence/{artifact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_evidence_artifact(
    artifact_id: str,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    user = get_org_user(db, p)
    require_evidence_delete(db, user.id, user.org_id, org_role=user.role)

    try:
        art_id = uuid.UUID(artifact_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid artifact_id")

    org_id = uuid.UUID(p["org_id"])
    row = db.get(EvidenceArtifact, art_id)
    if not row or row.org_id != org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "evidence not found")

    if row.storage_path:
        delete_artifact(row.storage_path)

    log_org_activity(
        db,
        org_id=org_id,
        actor_user_id=user.id,
        actor_email=user.email,
        action="evidence.removed",
        target_type="control",
        target_id=row.control_ref or row.composite_control_id or row.framework,
        target_label=row.title,
        detail={
            "artifact_id": str(row.id),
            "framework": row.framework,
            "composite_control_id": row.composite_control_id,
            "filename": row.filename,
            "had_external_url": bool(row.external_url),
        },
    )
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/evidence/{artifact_id}/review", response_model=EvidenceArtifactOut)
def review_evidence_artifact(
    artifact_id: str,
    body: EvidenceReviewIn,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    user = get_org_user(db, p)
    require_evidence_review(db, user.id, user.org_id, org_role=user.role)
    if body.status not in {"accepted", "rejected"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "status must be accepted or rejected")

    try:
        art_id = uuid.UUID(artifact_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid artifact_id")

    org_id = uuid.UUID(p["org_id"])
    row = db.get(EvidenceArtifact, art_id)
    if not row or row.org_id != org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "evidence not found")
    if row.status not in {"submitted", "accepted"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "only submitted or accepted evidence can be reviewed")

    row.status = body.status
    row.reviewed_by = user.id
    row.reviewed_at = datetime.now(timezone.utc)
    if body.review_notes is not None:
        row.review_notes = body.review_notes.strip() or None

    if body.status == "accepted":
        supersede_prior_accepted(db, org_id=org_id, new_artifact=row)

    log_org_activity(
        db,
        org_id=org_id,
        actor_user_id=user.id,
        actor_email=user.email,
        action=f"evidence.{body.status}",
        target_type="control",
        target_id=row.control_ref or row.composite_control_id or row.framework,
        target_label=row.title,
        detail={
            "artifact_id": str(row.id),
            "framework": row.framework,
            "composite_control_id": row.composite_control_id,
            "review_notes": row.review_notes,
        },
    )
    db.commit()
    db.refresh(row)
    reviewer_email = db.get(User, row.reviewed_by).email if row.reviewed_by else None
    return _artifact_out(row, reviewer_email=reviewer_email)


def _comment_out(row: EvidenceArtifactComment, author_email: str | None) -> EvidenceCommentOut:
    return EvidenceCommentOut(
        id=str(row.id),
        artifact_id=str(row.artifact_id),
        body=row.body,
        author_user_id=str(row.user_id) if row.user_id else None,
        author_email=author_email,
        created_at=row.created_at.isoformat() if row.created_at else "",
    )


@router.get("/evidence/{artifact_id}/comments", response_model=list[EvidenceCommentOut])
def list_evidence_comments(
    artifact_id: str,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    user = get_org_user(db, p)
    try:
        art_id = uuid.UUID(artifact_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid artifact_id")

    org_id = uuid.UUID(p["org_id"])
    artifact = db.get(EvidenceArtifact, art_id)
    if not artifact or artifact.org_id != org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "evidence not found")

    evidence_role = membership_evidence_role(db, user.id, org_id, fallback_org_role=user.role)
    assert_evidence_readable(artifact, evidence_role)

    rows = db.scalars(
        select(EvidenceArtifactComment)
        .where(EvidenceArtifactComment.artifact_id == art_id, EvidenceArtifactComment.org_id == org_id)
        .order_by(EvidenceArtifactComment.created_at.asc())
    ).all()
    emails: dict[uuid.UUID, str | None] = {}
    for row in rows:
        if row.user_id and row.user_id not in emails:
            author = db.get(User, row.user_id)
            emails[row.user_id] = author.email if author else None
    return [_comment_out(row, emails.get(row.user_id) if row.user_id else None) for row in rows]


@router.post("/evidence/{artifact_id}/comments", response_model=EvidenceCommentOut, status_code=status.HTTP_201_CREATED)
def add_evidence_comment(
    artifact_id: str,
    body: EvidenceCommentIn,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    user = get_org_user(db, p)
    require_evidence_comment(db, user.id, user.org_id, org_role=user.role)
    text = body.body.strip()
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "comment body is required")
    if len(text) > 4000:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "comment is too long")

    try:
        art_id = uuid.UUID(artifact_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid artifact_id")

    org_id = uuid.UUID(p["org_id"])
    artifact = db.get(EvidenceArtifact, art_id)
    if not artifact or artifact.org_id != org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "evidence not found")

    evidence_role = membership_evidence_role(db, user.id, org_id, fallback_org_role=user.role)
    assert_evidence_readable(artifact, evidence_role)

    row = EvidenceArtifactComment(
        org_id=org_id,
        artifact_id=art_id,
        user_id=user.id,
        body=text,
    )
    db.add(row)
    log_org_activity(
        db,
        org_id=org_id,
        actor_user_id=user.id,
        actor_email=user.email,
        action="evidence.comment_added",
        target_type="control",
        target_id=artifact.control_ref or artifact.composite_control_id or artifact.framework,
        target_label=artifact.title,
        detail={"artifact_id": str(artifact.id), "comment_id": str(row.id)},
    )
    db.commit()
    db.refresh(row)
    return _comment_out(row, user.email)


@router.delete(
    "/evidence/{artifact_id}/comments/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_evidence_comment(
    artifact_id: str,
    comment_id: str,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    user = get_org_user(db, p)

    try:
        art_id = uuid.UUID(artifact_id)
        comment_uuid = uuid.UUID(comment_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid artifact_id or comment_id")

    org_id = uuid.UUID(p["org_id"])
    artifact = db.get(EvidenceArtifact, art_id)
    if not artifact or artifact.org_id != org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "evidence not found")

    row = db.get(EvidenceArtifactComment, comment_uuid)
    if not row or row.artifact_id != art_id or row.org_id != org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "comment not found")

    is_author = row.user_id == user.id
    if not is_author and not role_at_least(user.role, "admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only the author or an admin can delete this comment")

    log_org_activity(
        db,
        org_id=org_id,
        actor_user_id=user.id,
        actor_email=user.email,
        action="evidence.comment_removed",
        target_type="control",
        target_id=artifact.control_ref or artifact.composite_control_id or artifact.framework,
        target_label=artifact.title,
        detail={"artifact_id": str(artifact.id), "comment_id": str(row.id)},
    )
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/check-frameworks", response_model=CheckFrameworksOut)
def get_check_frameworks(p=Depends(current_principal)):
    from app.services.check_evidence import CLASS_LABELS
    from app.services.check_coverage import check_coverage_tier_map

    return CheckFrameworksOut(
        frameworks=framework_catalog(),
        checks=check_framework_map(),
        coverage_tiers=check_coverage_tier_map(),
        evidence_classes=all_evidence_classes(),
        evidence_class_labels=CLASS_LABELS,
        cis_benchmark_coverage=cis_benchmark_coverage(),
    )


@router.get("/benchmark-coverage/{framework}")
def benchmark_coverage(framework: str, p=Depends(current_principal)):
    if framework == "cis_aws_l1":
        return cis_benchmark_coverage()
    raise HTTPException(status.HTTP_404_NOT_FOUND, "No coverage matrix for this framework")


@router.get("/by-check/{check_id}")
def controls_for_check(check_id: str, p=Depends(current_principal)):
    """Control documentation for a finding's check_id (SOC 2 → CIS → ISO priority)."""
    from app.services.check_controls import check_control_bundle

    return check_control_bundle(check_id)


@router.get("/composites", response_model=list[CompositeControlOut])
def list_composite_controls_route(
    account_id: str | None = Query(default=None),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Auditor-facing composite roll-ups (Secure SDLC, change management, logging, etc.)."""
    acc_id: uuid.UUID | None = None
    if account_id:
        acc = db.get(AwsAccount, uuid.UUID(account_id))
        if not acc or str(acc.org_id) != p["org_id"]:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
        acc_id = acc.id
    else:
        acc = db.scalars(
            select(AwsAccount).where(
                AwsAccount.org_id == uuid.UUID(p["org_id"]),
                AwsAccount.status == "connected",
            )
        ).first()
        if acc:
            acc_id = acc.id

    rows = list_composite_controls(db, uuid.UUID(p["org_id"]), acc_id)
    return [CompositeControlOut(**row) for row in rows]


@router.get("", response_model=list[ControlOut])
def list_controls(
    framework: str = Query(...),
    account_id: str | None = Query(default=None),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    if framework not in FRAMEWORKS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"framework must be one of {sorted(FRAMEWORKS)}")

    controls = db.scalars(
        select(Control).where(Control.framework == framework).order_by(Control.control_id)
    ).all()

    # Resolve account for this org
    acc: AwsAccount | None = None
    acc_id: uuid.UUID | None = None
    if account_id:
        acc = db.get(AwsAccount, uuid.UUID(account_id))
        if not acc or str(acc.org_id) != p["org_id"]:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
        acc_id = acc.id
    else:
        # Use first connected account
        acc = db.scalars(
            select(AwsAccount).where(
                AwsAccount.org_id == uuid.UUID(p["org_id"]),
                AwsAccount.status == "connected",
            )
        ).first()
        if acc:
            acc_id = acc.id

    org = db.get(Org, uuid.UUID(p["org_id"]))
    hidden = hidden_check_ids(org.settings if org else {})

    open_findings: list[Finding] = []
    latest_checks_run: set[str] = set()
    latest_failed_checks: set[str] = set()
    if acc_id:
        open_q = select(Finding).where(
            Finding.account_id == acc_id,
            Finding.status == "open",
        )
        if hidden:
            open_q = open_q.where(Finding.check_id.notin_(hidden))
        open_findings = db.scalars(open_q).all()

        latest_run = db.scalars(
            select(ScanRun)
            .where(
                ScanRun.account_id == acc_id,
                ScanRun.status.in_(("ok", "degraded")),
                ScanRun.finished_at.isnot(None),
            )
            .order_by(ScanRun.finished_at.desc())
            .limit(1)
        ).first()
        run_stats = latest_run.stats if latest_run and isinstance(latest_run.stats, dict) else {}
        latest_checks_raw = run_stats.get("checks_run") if isinstance(run_stats, dict) else None
        if isinstance(latest_checks_raw, list):
            latest_checks_run = {str(cid) for cid in latest_checks_raw}
        errors_raw = run_stats.get("check_errors") if isinstance(run_stats, dict) else None
        if isinstance(errors_raw, list):
            for err in errors_raw:
                if isinstance(err, dict) and err.get("check_id"):
                    latest_failed_checks.add(str(err["check_id"]))

    open_by_check: dict[str, list[Finding]] = {}
    for f in open_findings:
        open_by_check.setdefault(f.check_id, []).append(f)

    # Manual controls (no automated checks) take their status from the org's
    # attestation, so they roll into the same pass/fail tally as scanned controls.
    attest_by_control = {
        a.control_id: a
        for a in db.scalars(
            select(ControlAttestation).where(ControlAttestation.org_id == uuid.UUID(p["org_id"]))
        ).all()
    }

    result = []
    for ctrl in controls:
        mapped_check_ids = list(
            db.scalars(
                select(CheckControl.check_id).where(CheckControl.control_id == ctrl.id)
            ).all()
        )
        check_ids = [cid for cid in mapped_check_ids if cid not in hidden]

        kind = "auto"
        attestation_status: str | None = None
        if not mapped_check_ids:
            kind = "manual"
            a = attest_by_control.get(ctrl.id)
            attestation_status = a.status if a else "pending"
            ctrl_status = (
                "pass" if attestation_status == "met"
                else "fail" if attestation_status == "not_met"
                else "no_data"
            )
            hits = []
        else:
            has_scanned = bool(acc_id and acc and acc.last_scan_at)
            ctrl_status, hits, _ = compute_control_status(
                check_ids,
                open_by_check,
                latest_checks_run,
                latest_failed_checks,
                has_scanned_account=has_scanned,
            )

        detail = narrative_detail_for(ctrl.framework, ctrl.control_id, check_ids)
        cov_tier = control_coverage_tier(check_ids)
        ext_ids = extended_checks_in_list(check_ids)
        result.append(
            ControlOut(
                id=str(ctrl.id),
                framework=ctrl.framework,
                control_id=ctrl.control_id,
                title=ctrl.title,
                description=ctrl.description,
                guidance=ctrl.guidance,
                narrative=detail.get("long_answer") or narrative_for(ctrl.framework, ctrl.control_id),
                short_answer=detail.get("short_answer"),
                long_answer=detail.get("long_answer"),
                evidence_refs=list(detail.get("evidence_refs") or []),
                known_gaps=list(detail.get("known_gaps") or []),
                check_ids=check_ids,
                coverage_tier=cov_tier,
                coverage_label=tier_display_label(cov_tier),
                extended_check_ids=ext_ids,
                check_tiers={cid: tier_for_check(cid) for cid in check_ids},
                check_evidence_classes={cid: evidence_class_for_check(cid) for cid in check_ids},
                status=ctrl_status,
                finding_count=len(hits),
                open_finding_ids=[str(f.id) for f in hits],
                kind=kind,
                attestation_status=attestation_status,
                soc2_scope_category=ctrl.soc2_scope_category,
                cis_profile_level=ctrl.cis_profile_level,
                iso_applicability=ctrl.iso_applicability,
                iso_applicability_rationale=ctrl.iso_applicability_rationale,
            )
        )

    return result


class ChecklistControlOut(BaseModel):
    id: str
    control_id: str
    title: str
    description: str
    guidance: str | None
    group: str
    kind: str            # auto | manual
    status: str          # auto: pass|fail|no_data ; manual: met|not_met|not_applicable|pending
    check_ids: list[str] = []
    finding_count: int = 0
    owner: str | None = None
    note: str | None = None
    evidence_filename: str | None = None
    reviewed_at: str | None = None


class ChecklistSummary(BaseModel):
    total: int
    met: int
    not_applicable: int
    percent: int


class ChecklistOut(BaseModel):
    framework: str
    summary: ChecklistSummary
    controls: list[ChecklistControlOut]


@router.get("/checklist", response_model=ChecklistOut)
def control_checklist(
    framework: str = Query("soc2"),
    account_id: str | None = Query(default=None),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Full control catalog as a readiness checklist: automated controls take
    their pass/fail from the latest scan; controls with no checks are manual and
    take their status from the org's attestation. Returns a readiness %."""
    if framework not in FRAMEWORKS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"framework must be one of {sorted(FRAMEWORKS)}")

    org_id = uuid.UUID(p["org_id"])
    controls = db.scalars(
        select(Control).where(Control.framework == framework).order_by(Control.control_id)
    ).all()

    # Resolve account + latest scan for automated-control status.
    acc: AwsAccount | None = None
    acc_id: uuid.UUID | None = None
    if account_id:
        acc = db.get(AwsAccount, uuid.UUID(account_id))
        if not acc or str(acc.org_id) != p["org_id"]:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
        acc_id = acc.id
    else:
        acc = db.scalars(
            select(AwsAccount).where(AwsAccount.org_id == org_id, AwsAccount.status == "connected")
        ).first()
        if acc:
            acc_id = acc.id

    org = db.get(Org, org_id)
    hidden = hidden_check_ids(org.settings if org else {})

    open_by_check: dict[str, list[Finding]] = {}
    latest_checks_run: set[str] = set()
    latest_failed_checks: set[str] = set()
    if acc_id:
        open_q = select(Finding).where(Finding.account_id == acc_id, Finding.status == "open")
        if hidden:
            open_q = open_q.where(Finding.check_id.notin_(hidden))
        for f in db.scalars(open_q).all():
            open_by_check.setdefault(f.check_id, []).append(f)
        latest_run = db.scalars(
            select(ScanRun)
            .where(
                ScanRun.account_id == acc_id,
                ScanRun.status.in_(("ok", "degraded")),
                ScanRun.finished_at.isnot(None),
            )
            .order_by(ScanRun.finished_at.desc())
            .limit(1)
        ).first()
        run_stats = latest_run.stats if latest_run and isinstance(latest_run.stats, dict) else {}
        if isinstance(run_stats.get("checks_run"), list):
            latest_checks_run = {str(c) for c in run_stats["checks_run"]}
        if isinstance(run_stats.get("check_errors"), list):
            for err in run_stats["check_errors"]:
                if isinstance(err, dict) and err.get("check_id"):
                    latest_failed_checks.add(str(err["check_id"]))

    has_scanned = bool(acc_id and acc and acc.last_scan_at)

    attest_by_control = {
        a.control_id: a
        for a in db.scalars(select(ControlAttestation).where(ControlAttestation.org_id == org_id)).all()
    }

    out: list[ChecklistControlOut] = []
    met = 0
    na = 0
    for ctrl in controls:
        mapped = list(
            db.scalars(select(CheckControl.check_id).where(CheckControl.control_id == ctrl.id)).all()
        )
        group = ctrl.control_id.split(".")[0]
        if mapped:  # automated control — status from scan
            check_ids = [c for c in mapped if c not in hidden]
            ctrl_status, hits, _ = compute_control_status(
                check_ids,
                open_by_check,
                latest_checks_run,
                latest_failed_checks,
                has_scanned_account=has_scanned,
            )
            if ctrl_status == "pass":
                met += 1
            out.append(
                ChecklistControlOut(
                    id=str(ctrl.id),
                    control_id=ctrl.control_id,
                    title=ctrl.title,
                    description=ctrl.description,
                    guidance=ctrl.guidance,
                    group=group,
                    kind="auto",
                    status=ctrl_status,
                    check_ids=check_ids,
                    finding_count=len(hits),
                )
            )
        else:  # manual control — status from attestation
            a = attest_by_control.get(ctrl.id)
            st = a.status if a else "pending"
            if st == "met":
                met += 1
            elif st == "not_applicable":
                na += 1
            out.append(
                ChecklistControlOut(
                    id=str(ctrl.id),
                    control_id=ctrl.control_id,
                    title=ctrl.title,
                    description=ctrl.description,
                    guidance=ctrl.guidance,
                    group=group,
                    kind="manual",
                    status=st,
                    owner=a.owner if a else None,
                    note=a.note if a else None,
                    evidence_filename=a.evidence_filename if a else None,
                    reviewed_at=a.reviewed_at.isoformat() if (a and a.reviewed_at) else None,
                )
            )

    total = len(controls)
    denom = total - na
    percent = round(met / denom * 100) if denom > 0 else 0
    return ChecklistOut(
        framework=framework,
        summary=ChecklistSummary(total=total, met=met, not_applicable=na, percent=percent),
        controls=out,
    )


class AttestationIn(BaseModel):
    status: str
    owner: str | None = None
    note: str | None = None


@router.put("/{control_id}/attestation")
def put_attestation(
    control_id: str,
    body: AttestationIn,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Set a workspace's manual attestation for a control with no automated
    checks. Admin/owner only."""
    user = get_org_user(db, p)
    if not role_at_least(user.role, "admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin role required")
    if body.status not in ATTESTATION_STATUSES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"status must be one of {sorted(ATTESTATION_STATUSES)}"
        )
    try:
        cid = uuid.UUID(control_id)
    except ValueError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "control not found")
    ctrl = db.get(Control, cid)
    if not ctrl:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "control not found")
    if db.scalar(select(CheckControl.id).where(CheckControl.control_id == ctrl.id).limit(1)):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "control is automated; status is derived from scans"
        )

    org_id = uuid.UUID(p["org_id"])
    row = db.scalar(
        select(ControlAttestation).where(
            ControlAttestation.org_id == org_id, ControlAttestation.control_id == ctrl.id
        )
    )
    if row is None:
        row = ControlAttestation(org_id=org_id, control_id=ctrl.id)
        db.add(row)
    row.status = body.status
    row.owner = (body.owner or "").strip() or None
    row.note = (body.note or "").strip() or None
    row.updated_by = user.id
    row.reviewed_at = datetime.now(timezone.utc)
    db.flush()
    log_org_activity(
        db,
        org_id=org_id,
        actor_user_id=user.id,
        actor_email=user.email,
        action="control.attested",
        target_type="control",
        target_id=ctrl.control_id,
        target_label=ctrl.title,
        detail={"status": body.status},
    )
    db.commit()
    return {"ok": True, "control_id": ctrl.control_id, "status": row.status}


@router.get("/{control_id}/evidence")
def control_evidence(
    control_id: str,
    account_id: str = Query(...),
    period: int = Query(default=90, ge=7, le=365),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Return recent evidence snapshots relevant to a specific control."""
    ctrl = db.scalars(
        select(Control).where(Control.control_id == control_id)
    ).first()
    if not ctrl:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "control not found")

    acc = db.get(AwsAccount, uuid.UUID(account_id))
    if not acc or str(acc.org_id) != p["org_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")

    check_ids = list(
        db.scalars(select(CheckControl.check_id).where(CheckControl.control_id == ctrl.id)).all()
    )

    if not check_ids:
        return {
            "control_id": ctrl.control_id,
            "title": ctrl.title,
            "check_ids": [],
            "period_days": period,
            "snapshot_count": 0,
            "snapshots": [],
            "note": "No automated Veritrail checks are mapped to this control yet.",
        }

    entity_types = _entity_types_for_check_ids(check_ids)
    since = datetime.now(timezone.utc) - timedelta(days=period)

    q = select(EvidenceSnapshot).where(
        EvidenceSnapshot.account_id == acc.id,
        EvidenceSnapshot.taken_at >= since,
    )
    if entity_types:
        q = q.where(EvidenceSnapshot.entity_type.in_(entity_types))
    q = q.order_by(EvidenceSnapshot.taken_at.desc()).limit(200)

    snaps = db.scalars(q).all()
    return {
        "control_id": ctrl.control_id,
        "title": ctrl.title,
        "check_ids": check_ids,
        "period_days": period,
        "snapshot_count": len(snaps),
        "snapshots": [
            {
                "id": str(s.id),
                "entity_type": s.entity_type,
                "entity_id": s.entity_id,
                "taken_at": s.taken_at.isoformat(),
                "data": s.payload_json,
            }
            for s in snaps
        ],
    }


@router.get("/{control_id}/history")
def control_history(
    control_id: str,
    framework: str = Query(...),
    account_id: str = Query(...),
    days: int = Query(default=90, ge=7, le=365),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    if framework not in FRAMEWORKS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"framework must be one of {sorted(FRAMEWORKS)}")

    acc = db.get(AwsAccount, uuid.UUID(account_id))
    if not acc or str(acc.org_id) != p["org_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")

    try:
        return build_control_history(db, acc.id, framework, control_id, days)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


def _entity_types_for_check_ids(check_ids: list[str]) -> list[str]:
    types: set[str] = set()
    for cid in check_ids:
        if cid.startswith("iam.root"):
            types.add("account_summary")
        elif cid.startswith("iam.user"):
            types.add("iam_user")
        elif cid.startswith("iam.access_key"):
            types.add("iam_access_key")
        elif cid.startswith("iam.role"):
            types.add("iam_role")
        elif cid.startswith("s3.account."):
            types.add("s3_account_public_access_block")
        elif cid.startswith("s3."):
            types.add("s3_bucket")
        elif cid.startswith("kms."):
            types.add("kms_key")
        elif cid.startswith("cloudtrail."):
            types.add("cloudtrail_trail")
        elif cid.startswith("guardduty."):
            types.add("guardduty_detector")
        elif cid.startswith("aws.access_analyzer"):
            types.add("access_analyzer")
        elif cid.startswith("aws.config"):
            types.add("config_recorder")
        elif cid.startswith("aws.securityhub"):
            types.add("security_hub")
        elif cid.startswith("vpc."):
            types.add("vpc")
        elif cid.startswith("ec2.security_group"):
            types.add("security_group")
        elif cid.startswith("ec2.instance"):
            types.add("ec2_instance")
        elif cid.startswith("ec2.ebs"):
            types.add("ebs_volume")
            types.add("ebs_encryption_default")
        elif cid.startswith("rds.snapshot."):
            types.add("rds_snapshot")
        elif cid.startswith("rds."):
            types.add("rds_instance")
        elif cid.startswith("dynamodb."):
            types.add("dynamodb_table")
        elif cid.startswith("ecr."):
            types.add("ecr_repository")
        elif cid.startswith("eks."):
            types.add("eks_cluster")
        elif cid.startswith("lambda."):
            types.add("lambda_function")
        elif cid.startswith("acm."):
            types.add("acm_certificate")
        elif cid.startswith("secretsmanager."):
            types.add("secrets_manager_secret")
        elif cid.startswith("ssm."):
            types.add("ssm_parameter")
        elif cid.startswith("elb."):
            types.add("elb_load_balancer")
        elif cid.startswith("sns."):
            types.add("sns_topic")
        elif cid.startswith("sqs."):
            types.add("sqs_queue")
        elif cid.startswith("ec2.ami") or cid.startswith("ec2.ebs.snapshot"):
            types.add("ebs_snapshot")
            types.add("ec2_ami")
    return list(types)
