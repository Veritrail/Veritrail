import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.rbac import get_org_user, role_at_least
from app.core.security import current_principal
from app.data.control_narratives import narrative_for, narrative_detail_for
from app.models import Finding, AwsAccount, EvidenceSnapshot, ScanRun
from app.models.control import Control, CheckControl
from app.models.control_attestation import ATTESTATION_STATUSES, ControlAttestation
from app.models.org import Org
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
from app.services.composite_controls import list_composite_controls
from app.services.control_status import compute_control_status

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


class CompositeControlOut(BaseModel):
    id: str
    control_id: str
    title: str
    description: str
    guidance: str | None
    soc2_criteria: list[str]
    check_ids: list[str]
    coverage_tier: str = "core"
    coverage_label: str | None = None
    extended_check_ids: list[str] = []
    check_tiers: dict[str, str] = {}
    check_evidence_classes: dict[str, str] = {}
    status: str
    finding_count: int
    open_finding_ids: list[str]


class CheckFrameworksOut(BaseModel):
    frameworks: list[dict[str, str]]
    checks: dict[str, list[str]]
    coverage_tiers: dict[str, str] = {}
    evidence_classes: dict[str, str] = {}
    evidence_class_labels: dict[str, str] = {}
    cis_benchmark_coverage: dict | None = None


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
