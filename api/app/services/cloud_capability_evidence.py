"""Grade native cloud vulnerability capability lanes (Phase 2).

Builds EvidenceEnvelopes from collected AWS Inspector, GCP SCC/OS Config, and
Azure Defender rows. Enablement alone never yields covered.
"""
from __future__ import annotations

import uuid
from collections import Counter
from datetime import datetime, timezone
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.aws_account import AwsAccount
from app.models.azure_subscription import (
    AzureComputeInstance,
    AzureDefenderStatus,
    AzureSubscription,
)
from app.models.gcp_project import (
    GcpComputeInstance,
    GcpOsconfigVuln,
    GcpProject,
    GcpSecurityCommandCenter,
)
from app.models.resources import Ec2Instance, EcrRepository, InspectorAccountStatus, InspectorFinding, LambdaFunction
from app.services.technical_capability import (
    CapabilityId,
    EvidenceEnvelope,
    OpenFindingsSummary,
    envelope,
)


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _open_findings_from_severities(counts: Counter[str]) -> OpenFindingsSummary:
    return OpenFindingsSummary(
        critical=int(counts.get("CRITICAL", 0)),
        high=int(counts.get("HIGH", 0)),
        medium=int(counts.get("MEDIUM", 0)),
        low=int(counts.get("LOW", 0)) + int(counts.get("INFORMATIONAL", 0)) + int(counts.get("UNTRIAGED", 0)),
    )


def _resource_type_bucket(resource_type: str | None) -> str | None:
    rt = (resource_type or "").upper()
    if "EC2" in rt or "INSTANCE" in rt:
        return "ec2"
    if "ECR" in rt or "CONTAINER" in rt or "IMAGE" in rt:
        return "ecr"
    if "LAMBDA_CODE" in rt:
        return "lambda_code"
    if "LAMBDA" in rt:
        return "lambda"
    if "CODE_REPOSITORY" in rt or "REPOSITORY" in rt:
        return "code_repository"
    return None


def _inventory_confirmed(scope: Any) -> bool:
    """A zero-row inventory is authoritative only after a completed cloud scan."""
    return isinstance(getattr(scope, "last_scan_at", None), datetime)


def _aws_coverage(statuses: list[InspectorAccountStatus], bucket: str) -> tuple[int, str | None, list[str]]:
    assessed = 0
    observed: list[str] = []
    limitations: list[str] = []
    for status in statuses:
        evidence = status.evidence_json if isinstance(status.evidence_json, dict) else {}
        coverage = evidence.get("coverage") if isinstance(evidence.get("coverage"), dict) else {}
        row = coverage.get(bucket) if isinstance(coverage.get(bucket), dict) else {}
        assessed += int(row.get("assessed") or 0)
        if row.get("last_scanned_at"):
            observed.append(str(row["last_scanned_at"]))
        for limitation in row.get("limitations") or evidence.get("limitations") or []:
            if limitation not in limitations:
                limitations.append(str(limitation))
    if not any(isinstance(s.evidence_json, dict) and s.evidence_json.get("coverage") for s in statuses):
        limitations.append("inspector_resource_coverage_not_collected")
    return assessed, max(observed, default=None), limitations


def collect_aws_inspector_envelopes(
    db: Session,
    org_id: uuid.UUID,
    *,
    now: datetime,
) -> list[EvidenceEnvelope]:
    accounts = list(
        db.scalars(
            select(AwsAccount).where(
                AwsAccount.org_id == org_id,
                AwsAccount.status == "connected",
            )
        ).all()
    )
    out: list[EvidenceEnvelope] = []
    for account in accounts:
        statuses = list(
            db.scalars(
                select(InspectorAccountStatus).where(InspectorAccountStatus.account_id == account.id)
            ).all()
        )
        findings = list(
            db.scalars(select(InspectorFinding).where(InspectorFinding.account_id == account.id)).all()
        )
        ec2_count = int(
            db.scalar(
                select(func.count()).select_from(Ec2Instance).where(Ec2Instance.account_id == account.id)
            )
            or 0
        )
        ecr_count = int(
            db.scalar(
                select(func.count()).select_from(EcrRepository).where(EcrRepository.account_id == account.id)
            )
            or 0
        )
        lambda_count = int(
            db.scalar(
                select(func.count())
                .select_from(LambdaFunction)
                .where(LambdaFunction.account_id == account.id)
            )
            or 0
        )

        if not statuses:
            # Connected account with no Inspector collector data → unknown denominator.
            for capability, provider, asset_type in (
                ("host_workload_scanning", "amazon_inspector_ec2", "ec2_instance"),
                ("container_image_scanning", "amazon_inspector_ecr", "container_image"),
                ("serverless_scanning", "amazon_inspector_lambda", "lambda_function"),
                ("cloud_findings_posture", "amazon_inspector", "aws_account"),
            ):
                out.append(
                    envelope(
                        capability=capability,  # type: ignore[arg-type]
                        provider=provider,
                        scope_type="aws_account",
                        scope_id=account.account_id or str(account.id),
                        asset_type=asset_type,
                        enabled=None,
                        has_observable_activity=False,
                        limitations=["inspector_status_not_collected"],
                        now=now,
                    )
                )
            continue

        any_ec2 = any(s.ec2_enabled for s in statuses)
        any_ecr = any(s.ecr_enabled for s in statuses)
        any_lambda = any(s.lambda_enabled for s in statuses)
        any_lambda_code = any(getattr(s, "lambda_code_enabled", False) for s in statuses)
        any_code_repository = any(getattr(s, "code_repository_enabled", False) for s in statuses)
        last_seen = max((s.last_seen for s in statuses if s.last_seen), default=None)
        last_iso = _iso(last_seen)
        ec2_assessed, ec2_scan_at, ec2_limitations = _aws_coverage(statuses, "ec2")
        ecr_assessed, ecr_scan_at, ecr_limitations = _aws_coverage(statuses, "ecr")
        lambda_assessed, lambda_scan_at, lambda_limitations = _aws_coverage(statuses, "lambda")
        code_assessed, code_scan_at, code_limitations = _aws_coverage(statuses, "code_repository")

        finding_by_bucket: dict[str, Counter[str]] = {
            "ec2": Counter(),
            "ecr": Counter(),
            "lambda": Counter(),
            "lambda_code": Counter(),
            "other": Counter(),
        }
        for f in findings:
            bucket = _resource_type_bucket(f.resource_type) or "other"
            finding_by_bucket.setdefault(bucket, Counter())[str(f.severity or "").upper()] += 1

        # Host / EC2
        if ec2_count == 0 and not any_ec2 and _inventory_confirmed(account):
            out.append(
                envelope(
                    capability="host_workload_scanning",
                    provider="amazon_inspector_ec2",
                    scope_type="aws_account",
                    scope_id=account.account_id or str(account.id),
                    asset_type="ec2_instance",
                    enabled=False,
                    has_observable_activity=False,
                    intentionally_excluded=True,
                    eligible=0,
                    assessed=0,
                    limitations=["no_ec2_inventory"],
                    now=now,
                )
            )

        else:
            out.append(
                envelope(
                    capability="host_workload_scanning",
                    provider="amazon_inspector_ec2",
                    scope_type="aws_account",
                    scope_id=account.account_id or str(account.id),
                    asset_type="ec2_instance",
                    enabled=any_ec2,
                    has_observable_activity=any_ec2 and ec2_assessed > 0 and bool(ec2_scan_at),
                    last_observed_at=last_iso,
                    last_successful_scan_at=ec2_scan_at,
                    eligible=max(ec2_count, 1 if any_ec2 else 0),
                    assessed=min(ec2_assessed, ec2_count) if ec2_count else ec2_assessed,
                    open_findings=_open_findings_from_severities(finding_by_bucket["ec2"]),
                    source_reference=f"inspector:ec2:{account.account_id or account.id}",
                    limitations=ec2_limitations if any_ec2 else ["inspector_ec2_disabled"],
                    now=now,
                )
            )

        if any_code_repository or code_assessed > 0:
            out.append(
                envelope(
                    capability="source_code_scanning",
                    provider="amazon_inspector_code",
                    scope_type="aws_account",
                    scope_id=account.account_id or str(account.id),
                    asset_type="code_repository",
                    enabled=any_code_repository,
                    has_observable_activity=any_code_repository and code_assessed > 0 and bool(code_scan_at),
                    last_observed_at=last_iso,
                    last_successful_scan_at=code_scan_at,
                    eligible=max(code_assessed, 1 if any_code_repository else 0),
                    assessed=code_assessed,
                    source_reference=f"inspector:code:{account.account_id or account.id}",
                    limitations=code_limitations,
                    now=now,
                )
            )

        # ECR / containers
        if ecr_count == 0 and not any_ecr and _inventory_confirmed(account):
            out.append(
                envelope(
                    capability="container_image_scanning",
                    provider="amazon_inspector_ecr",
                    scope_type="aws_account",
                    scope_id=account.account_id or str(account.id),
                    asset_type="container_image",
                    enabled=False,
                    has_observable_activity=False,
                    intentionally_excluded=True,
                    eligible=0,
                    assessed=0,
                    limitations=["no_ecr_inventory"],
                    now=now,
                )
            )
        else:
            out.append(
                envelope(
                    capability="container_image_scanning",
                    provider="amazon_inspector_ecr",
                    scope_type="aws_account",
                    scope_id=account.account_id or str(account.id),
                    asset_type="container_image",
                    enabled=any_ecr,
                    has_observable_activity=any_ecr and ecr_assessed > 0 and bool(ecr_scan_at),
                    last_observed_at=last_iso,
                    last_successful_scan_at=ecr_scan_at,
                    eligible=max(ecr_count, 1 if any_ecr else 0),
                    assessed=min(ecr_assessed, ecr_count) if ecr_count else ecr_assessed,
                    open_findings=_open_findings_from_severities(finding_by_bucket["ecr"]),
                    source_reference=f"inspector:ecr:{account.account_id or account.id}",
                    limitations=ecr_limitations if any_ecr else ["inspector_ecr_disabled"],
                    now=now,
                )
            )

        # Serverless / Lambda
        lambda_enabled = any_lambda or any_lambda_code
        if lambda_count == 0 and not lambda_enabled and _inventory_confirmed(account):
            out.append(
                envelope(
                    capability="serverless_scanning",
                    provider="amazon_inspector_lambda",
                    scope_type="aws_account",
                    scope_id=account.account_id or str(account.id),
                    asset_type="lambda_function",
                    enabled=False,
                    has_observable_activity=False,
                    intentionally_excluded=True,
                    eligible=0,
                    assessed=0,
                    limitations=["no_lambda_inventory"],
                    now=now,
                )
            )
        else:
            lim: list[str] = list(lambda_limitations)
            if any_lambda and not any_lambda_code:
                lim.append("lambda_standard_only_code_scanning_off")
            out.append(
                envelope(
                    capability="serverless_scanning",
                    provider="amazon_inspector_lambda" if any_lambda else "amazon_inspector_lambda_code",
                    scope_type="aws_account",
                    scope_id=account.account_id or str(account.id),
                    asset_type="lambda_function",
                    enabled=lambda_enabled,
                    has_observable_activity=lambda_enabled and lambda_assessed > 0 and bool(lambda_scan_at),
                    last_observed_at=last_iso,
                    last_successful_scan_at=lambda_scan_at,
                    eligible=max(lambda_count, 1 if lambda_enabled else 0),
                    assessed=min(lambda_assessed, lambda_count) if lambda_count else lambda_assessed,
                    open_findings=_open_findings_from_severities(
                        finding_by_bucket["lambda"] + finding_by_bucket["lambda_code"]
                    ),
                    source_reference=f"inspector:lambda:{account.account_id or account.id}",
                    limitations=lim,
                    now=now,
                )
            )

        # Cloud findings / posture rollup for Inspector
        any_enabled = any_ec2 or any_ecr or lambda_enabled
        out.append(
            envelope(
                capability="cloud_findings_posture",
                provider="amazon_inspector",
                scope_type="aws_account",
                scope_id=account.account_id or str(account.id),
                asset_type="aws_account",
                enabled=any_enabled,
                has_observable_activity=any_enabled
                and (ec2_assessed + ecr_assessed + lambda_assessed) > 0,
                last_observed_at=last_iso,
                last_successful_scan_at=max(
                    (value for value in (ec2_scan_at, ecr_scan_at, lambda_scan_at) if value),
                    default=None,
                ),
                eligible=1,
                assessed=1 if any_enabled and (ec2_assessed + ecr_assessed + lambda_assessed) > 0 else 0,
                open_findings=_open_findings_from_severities(
                    sum((finding_by_bucket[k] for k in finding_by_bucket), Counter())
                ),
                source_reference=f"inspector:account:{account.account_id or account.id}",
                limitations=(
                    list(dict.fromkeys(ec2_limitations + ecr_limitations + lambda_limitations))
                    if any_enabled
                    else ["inspector_disabled_all_resource_types"]
                ),
                now=now,
            )
        )
    return out


def collect_gcp_envelopes(
    db: Session,
    org_id: uuid.UUID,
    *,
    now: datetime,
) -> list[EvidenceEnvelope]:
    projects = list(
        db.scalars(
            select(GcpProject).where(
                GcpProject.org_id == org_id,
                GcpProject.status == "connected",
            )
        ).all()
    )
    out: list[EvidenceEnvelope] = []
    for project in projects:
        vm_count = int(
            db.scalar(
                select(func.count())
                .select_from(GcpComputeInstance)
                .where(GcpComputeInstance.gcp_project_id == project.id)
            )
            or 0
        )
        osconfig = db.scalar(
            select(GcpOsconfigVuln).where(GcpOsconfigVuln.gcp_project_id == project.id)
        )
        scc = db.scalar(
            select(GcpSecurityCommandCenter).where(
                GcpSecurityCommandCenter.gcp_project_id == project.id
            )
        )

        # Host / OS Config
        if osconfig is None and vm_count == 0:
            out.append(
                envelope(
                    capability="host_workload_scanning",
                    provider="gcp_osconfig",
                    scope_type="gcp_project",
                    scope_id=project.project_id,
                    asset_type="compute_instance",
                    enabled=None,
                    has_observable_activity=False,
                    limitations=["osconfig_not_collected"],
                    now=now,
                )
            )
        elif vm_count == 0 and osconfig and not osconfig.has_reports and _inventory_confirmed(project):
            out.append(
                envelope(
                    capability="host_workload_scanning",
                    provider="gcp_osconfig",
                    scope_type="gcp_project",
                    scope_id=project.project_id,
                    asset_type="compute_instance",
                    enabled=False,
                    has_observable_activity=False,
                    intentionally_excluded=True,
                    eligible=0,
                    assessed=0,
                    limitations=["no_gce_inventory"],
                    now=now,
                )
            )
        else:
            api_ok = bool(osconfig and osconfig.api_accessible)
            has_reports = bool(osconfig and osconfig.has_reports)
            last_iso = _iso(osconfig.last_seen if osconfig else None)
            evidence = (osconfig.evidence_json if osconfig and isinstance(osconfig.evidence_json, dict) else {}) or {}
            lim = list(evidence.get("limitations") or [])
            if osconfig and not api_ok:
                lim.append("osconfig_api_inaccessible")
            out.append(
                envelope(
                    capability="host_workload_scanning",
                    provider="gcp_osconfig",
                    scope_type="gcp_project",
                    scope_id=project.project_id,
                    asset_type="compute_instance",
                    enabled=api_ok,
                    has_observable_activity=has_reports,
                    last_observed_at=last_iso,
                    last_successful_scan_at=last_iso if has_reports else None,
                    eligible=max(vm_count, int(osconfig.report_count) if osconfig else 0, 1 if api_ok else 0),
                    assessed=int(osconfig.report_count) if osconfig and has_reports else 0,
                    open_findings=OpenFindingsSummary(
                        critical=int(evidence.get("critical") or 0),
                        high=int(evidence.get("high") or 0),
                        medium=int(evidence.get("medium") or 0),
                        low=int(evidence.get("low") or 0),
                    ),
                    source_reference=f"gcp:osconfig:{project.project_id}",
                    limitations=lim,
                    permission_denied=bool(osconfig and not api_ok),
                    now=now,
                )
            )

        # SCC → cloud findings posture (aggregation plane honesty)
        if scc is None:
            out.append(
                envelope(
                    capability="cloud_findings_posture",
                    provider="gcp_scc",
                    scope_type="gcp_project",
                    scope_id=project.project_id,
                    asset_type="gcp_project",
                    enabled=None,
                    has_observable_activity=False,
                    limitations=["scc_not_collected"],
                    now=now,
                )
            )
        else:
            evidence = scc.evidence_json if isinstance(scc.evidence_json, dict) else {}
            lim = list(evidence.get("limitations") or [])
            if scc.scc_enabled and not evidence.get("vulnerability_sources"):
                lim.append("scc_accessible_sources_not_enumerated")
            # SCC enabled without vulnerability-class findings still only partial.
            vuln_count = int(evidence.get("vulnerability_finding_count") or scc.high_severity_count or 0)
            has_activity = scc.scc_enabled and (
                scc.active_finding_count > 0 or bool(evidence.get("sources_observed"))
            )
            out.append(
                envelope(
                    capability="cloud_findings_posture",
                    provider="gcp_scc",
                    scope_type="gcp_project",
                    scope_id=project.project_id,
                    asset_type="gcp_project",
                    enabled=bool(scc.scc_enabled),
                    has_observable_activity=has_activity,
                    last_observed_at=_iso(scc.last_seen),
                    last_successful_scan_at=_iso(scc.last_seen) if scc.scc_enabled else None,
                    eligible=1,
                    assessed=1 if has_activity else 0,
                    open_findings=OpenFindingsSummary(
                        critical=int(evidence.get("critical") or 0),
                        high=int(evidence.get("high") or scc.high_severity_count or 0),
                        medium=int(evidence.get("medium") or 0),
                        low=int(evidence.get("low") or max(0, scc.active_finding_count - vuln_count)),
                    ),
                    source_reference=f"gcp:scc:{project.project_id}",
                    limitations=lim,
                    now=now,
                )
            )
            # Host lane may also credit SCC vulnerability sources when OS Config is thin.
            if scc.scc_enabled and evidence.get("vulnerability_finding_count"):
                out.append(
                    envelope(
                        capability="host_workload_scanning",
                        provider="gcp_scc",
                        scope_type="gcp_project",
                        scope_id=project.project_id,
                        asset_type="compute_instance",
                        enabled=True,
                        has_observable_activity=True,
                        last_observed_at=_iso(scc.last_seen),
                        last_successful_scan_at=_iso(scc.last_seen),
                        eligible=max(vm_count, 1),
                        assessed=max(vm_count, 1) if vuln_count else 0,
                        open_findings=OpenFindingsSummary(
                            critical=int(evidence.get("critical") or 0),
                            high=int(evidence.get("high") or 0),
                            medium=int(evidence.get("medium") or 0),
                            low=int(evidence.get("low") or 0),
                        ),
                        source_reference=f"gcp:scc-vuln:{project.project_id}",
                        limitations=["scc_aggregator_not_full_vm_coverage"],
                        now=now,
                    )
                )
    return out


_DEFENDER_PLAN_TO_CAPABILITY: dict[str, tuple[CapabilityId, str, str]] = {
    "virtualmachines": ("host_workload_scanning", "defender_servers", "azure_vm"),
    "servers": ("host_workload_scanning", "defender_servers", "azure_vm"),
    "containers": ("container_image_scanning", "defender_containers", "container_workload"),
    "containerregistry": ("container_image_scanning", "defender_containers", "container_registry"),
    "kuberneteservice": ("container_image_scanning", "defender_containers", "aks_cluster"),
    "cloudposture": ("cloud_findings_posture", "defender_for_cloud", "azure_subscription"),
    "arm": ("cloud_findings_posture", "defender_for_cloud", "azure_subscription"),
}


def collect_azure_defender_envelopes(
    db: Session,
    org_id: uuid.UUID,
    *,
    now: datetime,
) -> list[EvidenceEnvelope]:
    subs = list(
        db.scalars(
            select(AzureSubscription).where(
                AzureSubscription.org_id == org_id,
                AzureSubscription.status == "connected",
            )
        ).all()
    )
    out: list[EvidenceEnvelope] = []
    for sub in subs:
        status = db.scalar(
            select(AzureDefenderStatus).where(
                AzureDefenderStatus.azure_subscription_id == sub.id
            )
        )
        vm_count = int(
            db.scalar(
                select(func.count())
                .select_from(AzureComputeInstance)
                .where(AzureComputeInstance.azure_subscription_id == sub.id)
            )
            or 0
        )
        if status is None:
            out.append(
                envelope(
                    capability="cloud_findings_posture",
                    provider="defender_for_cloud",
                    scope_type="azure_subscription",
                    scope_id=sub.subscription_id,
                    asset_type="azure_subscription",
                    enabled=None,
                    has_observable_activity=False,
                    limitations=["defender_status_not_collected"],
                    now=now,
                )
            )
            continue

        evidence = status.evidence_json if isinstance(status.evidence_json, dict) else {}
        plans = evidence.get("plans") if isinstance(evidence.get("plans"), dict) else {}
        last_iso = _iso(status.last_seen)
        open_findings = OpenFindingsSummary(
            critical=int(evidence.get("critical") or 0),
            high=int(evidence.get("high") or 0),
            medium=int(evidence.get("medium") or 0),
            low=int(evidence.get("low") or 0),
        )

        # Per-plan grading when plan inventory is available.
        if plans:
            seen_caps: set[str] = set()
            for plan_name, plan_info in plans.items():
                key = str(plan_name).lower().replace(" ", "").replace("_", "")
                mapping = _DEFENDER_PLAN_TO_CAPABILITY.get(key)
                if not mapping:
                    continue
                capability, provider, asset_type = mapping
                tier = ""
                if isinstance(plan_info, dict):
                    tier = str(plan_info.get("pricing_tier") or plan_info.get("tier") or "")
                    enabled_plan = bool(plan_info.get("enabled")) or tier.lower() not in ("", "free")
                else:
                    enabled_plan = str(plan_info).lower() not in ("", "free")
                # Avoid double-emitting same capability from multiple plan aliases.
                if capability in seen_caps:
                    continue
                seen_caps.add(capability)
                eligible = vm_count if capability == "host_workload_scanning" else 1
                if (
                    capability == "host_workload_scanning"
                    and vm_count == 0
                    and not enabled_plan
                    and _inventory_confirmed(sub)
                ):
                    out.append(
                        envelope(
                            capability=capability,
                            provider=provider,
                            scope_type="azure_subscription",
                            scope_id=sub.subscription_id,
                            asset_type=asset_type,
                            enabled=False,
                            has_observable_activity=False,
                            intentionally_excluded=True,
                            eligible=0,
                            assessed=0,
                            limitations=["no_azure_vm_inventory"],
                            now=now,
                        )
                    )
                    continue
                coverage_by_cap = (
                    evidence.get("coverage", {}).get(str(capability), {})
                    if isinstance(evidence.get("coverage"), dict)
                    else {}
                )
                assessed = int(coverage_by_cap.get("assessed") or 0)
                last_assessed = coverage_by_cap.get("last_assessed_at")
                out.append(
                    envelope(
                        capability=capability,
                        provider=provider,
                        scope_type="azure_subscription",
                        scope_id=sub.subscription_id,
                        asset_type=asset_type,
                        enabled=enabled_plan,
                        has_observable_activity=enabled_plan and assessed > 0 and bool(last_assessed),
                        last_observed_at=last_iso,
                        last_successful_scan_at=str(last_assessed) if last_assessed else None,
                        eligible=max(eligible, 1 if enabled_plan else 0),
                        assessed=min(assessed, eligible) if eligible else assessed,
                        open_findings=open_findings if capability != "container_image_scanning" else OpenFindingsSummary(),
                        source_reference=f"defender:{plan_name}:{sub.subscription_id}",
                        limitations=(
                            []
                            if enabled_plan and assessed > 0 and last_assessed
                            else (
                                ["defender_resource_coverage_not_collected"]
                                if enabled_plan
                                else [f"defender_plan_{key}_not_standard"]
                            )
                        ),
                        now=now,
                    )
                )
            # Always emit cloud posture from overall defender flag.
            if "cloud_findings_posture" not in seen_caps:
                out.append(
                    envelope(
                        capability="cloud_findings_posture",
                        provider="defender_for_cloud",
                        scope_type="azure_subscription",
                        scope_id=sub.subscription_id,
                        asset_type="azure_subscription",
                        enabled=bool(status.defender_enabled),
                        has_observable_activity=bool(status.defender_enabled)
                        and int(evidence.get("assessment_count") or 0) > 0,
                        last_observed_at=last_iso,
                        last_successful_scan_at=last_iso if status.defender_enabled else None,
                        eligible=1,
                        assessed=1
                        if status.defender_enabled and int(evidence.get("assessment_count") or 0) > 0
                        else 0,
                        open_findings=open_findings,
                        source_reference=f"defender:subscription:{sub.subscription_id}",
                        limitations=["enablement_only_plan_detail_missing"]
                        if status.defender_enabled and not plans
                        else ([] if status.defender_enabled else ["defender_not_enabled"]),
                        now=now,
                    )
                )
            continue

        # Legacy: only aggregate defender_enabled / pricing_tier.
        lim = ["enablement_only_no_plan_inventory"]
        if status.defender_enabled and (status.pricing_tier or "").lower() == "free":
            lim.append("defender_free_tier")
        out.append(
            envelope(
                capability="cloud_findings_posture",
                provider="defender_for_cloud",
                scope_type="azure_subscription",
                scope_id=sub.subscription_id,
                asset_type="azure_subscription",
                enabled=bool(status.defender_enabled),
                has_observable_activity=False,
                last_observed_at=last_iso,
                last_successful_scan_at=last_iso if status.defender_enabled else None,
                eligible=1,
                assessed=0,
                open_findings=open_findings,
                source_reference=f"defender:subscription:{sub.subscription_id}",
                limitations=lim if status.defender_enabled else ["defender_not_enabled"],
                now=now,
            )
        )
        if vm_count > 0 or status.defender_enabled:
            out.append(
                envelope(
                    capability="host_workload_scanning",
                    provider="defender_servers",
                    scope_type="azure_subscription",
                    scope_id=sub.subscription_id,
                    asset_type="azure_vm",
                    enabled=bool(status.defender_enabled),
                    has_observable_activity=False,
                    last_observed_at=last_iso,
                    eligible=max(vm_count, 1 if status.defender_enabled else 0),
                    assessed=0,
                    limitations=["servers_plan_not_confirmed"] + lim,
                    now=now,
                )
            )
    return out


def collect_native_cloud_envelopes(
    db: Session,
    org_id: uuid.UUID,
    *,
    now: datetime | None = None,
) -> list[EvidenceEnvelope]:
    ref = now or datetime.now(timezone.utc)
    envelopes: list[EvidenceEnvelope] = []
    envelopes.extend(collect_aws_inspector_envelopes(db, org_id, now=ref))
    envelopes.extend(collect_gcp_envelopes(db, org_id, now=ref))
    envelopes.extend(collect_azure_defender_envelopes(db, org_id, now=ref))
    return envelopes


def connected_cloud_providers(db: Session, org_id: uuid.UUID) -> set[str]:
    """Provider IDs present when cloud accounts are connected (for lane attribution)."""
    providers: set[str] = set()
    if db.scalar(
        select(AwsAccount.id).where(AwsAccount.org_id == org_id, AwsAccount.status == "connected").limit(1)
    ):
        providers.update(
            {
                "amazon_inspector",
                "amazon_inspector_ec2",
                "amazon_inspector_ecr",
                "amazon_inspector_lambda",
                "amazon_inspector_lambda_code",
            }
        )
    if db.scalar(
        select(GcpProject.id).where(GcpProject.org_id == org_id, GcpProject.status == "connected").limit(1)
    ):
        providers.update({"gcp_osconfig", "gcp_scc"})
    if db.scalar(
        select(AzureSubscription.id)
        .where(AzureSubscription.org_id == org_id, AzureSubscription.status == "connected")
        .limit(1)
    ):
        providers.update({"defender_for_cloud", "defender_servers", "defender_containers"})
    return providers
