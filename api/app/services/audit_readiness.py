"""Org-wide audit readiness narratives — shared builder with the evidence PDF."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    AwsAccount,
    AzureSubscription,
    EvidenceSnapshot,
    Finding,
    FindingEvent,
    GcpProject,
    ScanRun,
)
from app.models.control import CheckControl, Control
from app.models.github import IdentityProvider
from app.models.org import Org
from app.services.check_settings import hidden_check_ids
from app.services.compliance_timeline import build_control_history
from app.services.evidence_pack import _control_status, _finding_dict
from app.services.finding_history import STATE_EXCEPTED, STATE_OPEN, findings_for_pack_at
from app.services.org_control_mappings import load_org_mapping_index
from app.services.pdf_narrative import (
    DOMAIN_DEFS,
    build_domain_sections,
    domain_for_check,
    domain_section_as_dict,
)
from app.services.seed_controls import effective_checks_for_control_row
from app.services.source_control_scan import with_source_control_for_audit

_VULN_CHECKS = frozenset(
    {
        "aws.inspector.active_critical_finding",
        "aws.vulnerability_monitoring.not_detected",
        "ecr.repository.image_scan_disabled",
        "ecr.registry.enhanced_scanning_disabled",
    }
)
_SDLC_CHECKS = frozenset(
    {
        "github.repo.no_branch_protection",
        "gitlab.repo.no_branch_protection",
        "github.repo.dependabot_disabled",
        "github.repo.secret_scanning_disabled",
        "github.repo.code_scanning_disabled",
    }
)

_PROVIDER_PREFIXES: dict[str, tuple[str, ...]] = {
    "azure": ("azure.",),
    "gcp": ("gcp.",),
    "entra_id": ("entra.", "azure.entra."),
    "google_workspace": ("google_workspace.",),
    "github": ("github.",),
    "gitlab": ("gitlab.",),
    "scanner_wiz": ("scanner.wiz.",),
    "scanner_tenable": ("scanner.tenable.",),
    "scanner_qualys": ("scanner.qualys.",),
    "scanner_snyk": ("scanner.snyk.",),
    "scanner_orca": ("scanner.orca.",),
    "scanner_aikido": ("scanner.aikido.",),
}

_AUDITOR_TECHNICAL_PLAYBOOKS: tuple[dict[str, Any], ...] = (
    {
        "key": "disaster_recovery",
        "label": "Disaster recovery (DR)",
        "question": "Can in-scope data services be recovered after a failure?",
        "outcome": "Recovery protections are checked only for data and stateful resources found in the latest complete inventory.",
        "narrative_domain_keys": ("backup_dr",),
        "items": (
            {
                "key": "rds_recovery",
                "label": "RDS recovery protections",
                "verified_text": "Automated backups, deletion protection, and configured resilience checks report no open gaps.",
                "action_text": "Enable or review RDS backups and recovery protection.",
                "checks": (
                    "rds.instance.no_automated_backup",
                    "rds.instance.no_deletion_protection",
                    "rds.instance.no_multi_az",
                ),
                "required_types": frozenset({"rds_instance"}),
                "resource_label": "RDS databases",
                "activation_checks": (
                    "rds.instance.no_automated_backup",
                    "rds.instance.no_deletion_protection",
                    "rds.instance.no_multi_az",
                ),
                "action_label": "Activate RDS recovery",
                "action_url": "https://console.aws.amazon.com/rds/home#databases:",
            },
            {
                "key": "dynamodb_recovery",
                "label": "DynamoDB point-in-time recovery",
                "verified_text": "Point-in-time recovery reports no open gaps for in-scope DynamoDB tables.",
                "action_text": "Enable point-in-time recovery for affected DynamoDB tables.",
                "checks": ("dynamodb.table.no_pitr",),
                "required_types": frozenset({"dynamodb_table"}),
                "resource_label": "DynamoDB tables",
                "activation_checks": ("dynamodb.table.no_pitr",),
                "action_label": "Activate PITR",
                "action_url": "https://console.aws.amazon.com/dynamodbv2/home#tables",
            },
            {
                "key": "backup_coverage",
                "label": "Backup plan coverage",
                "verified_text": "AWS Backup plan coverage reports no open gaps for eligible resources.",
                "action_text": "Create or extend an AWS Backup plan for uncovered resources.",
                "checks": ("backup.plan.missing",),
                "required_types": frozenset(
                    {"rds_instance", "dynamodb_table", "ec2_instance", "ebs_volume"}
                ),
                "resource_label": "backup-eligible resources",
                "activation_checks": ("backup.plan.missing",),
                "action_label": "Activate AWS Backup",
                "action_url": "https://console.aws.amazon.com/backup/home",
            },
        ),
    },
    {
        "key": "vulnerability_management",
        "label": "Vulnerability management",
        "question": "Are vulnerabilities and active threats detected with technical tooling?",
        "outcome": "This covers observable AWS detection and scanning services only; remediation process and runbooks remain outside automated scope.",
        "narrative_domain_keys": ("vulnerability_management", "incident_response"),
        "items": (
            {
                "key": "guardduty",
                "label": "Amazon GuardDuty",
                "verified_text": "GuardDuty is enabled and its collected findings report no open gaps.",
                "action_text": "Enable GuardDuty or review its unresolved detector findings.",
                "checks": (
                    "guardduty.detector.not_enabled",
                    "guardduty.open_findings",
                    "cloudtrail.event.guardduty_disabled",
                ),
                "activation_checks": ("guardduty.detector.not_enabled",),
                "action_label": "Activate GuardDuty",
                "action_url": "https://console.aws.amazon.com/guardduty/home",
            },
            {
                "key": "security_hub",
                "label": "AWS Security Hub",
                "verified_text": "Security Hub enablement reports no open gaps.",
                "action_text": "Enable Security Hub for centralized security findings.",
                "checks": ("aws.securityhub.not_enabled",),
                "activation_checks": ("aws.securityhub.not_enabled",),
                "action_label": "Activate Security Hub",
                "action_url": "https://console.aws.amazon.com/securityhub/home",
            },
            {
                "key": "workload_scanning",
                "label": "Inspector and workload scanning",
                "verified_text": "Applicable compute or container workloads have collected vulnerability-scanning evidence.",
                "action_text": "Enable Inspector or ECR image scanning for the workloads found in scope.",
                "checks": (
                    "aws.vulnerability_monitoring.not_detected",
                    "aws.inspector.active_critical_finding",
                    "ecr.registry.enhanced_scanning_disabled",
                    "ecr.repository.image_scan_disabled",
                ),
                "required_types": frozenset(
                    {
                        "ec2_instance",
                        "ecs_cluster",
                        "ecs_service",
                        "eks_cluster",
                        "ecr_repository",
                    }
                ),
                "resource_label": "EC2, ECS, EKS, or ECR workloads",
                "positive_evidence_gap_types": frozenset({"ec2_instance"}),
                "activation_checks": (
                    "aws.vulnerability_monitoring.not_detected",
                    "ecr.registry.enhanced_scanning_disabled",
                    "ecr.repository.image_scan_disabled",
                ),
                "action_label": "Activate workload scanning",
                "action_url": "https://console.aws.amazon.com/inspector/v2/home",
            },
        ),
    },
    {
        "key": "logging_monitoring",
        "label": "Logging and monitoring",
        "question": "Can security-relevant activity be reconstructed and monitored?",
        "outcome": "The checklist verifies observable logging, configuration recording, and network telemetry settings.",
        "narrative_domain_keys": ("logging_monitoring",),
        "items": (
            {
                "key": "cloudtrail",
                "label": "CloudTrail audit logging",
                "verified_text": "CloudTrail coverage, integrity, encryption, and log delivery checks report no open gaps.",
                "action_text": "Enable CloudTrail or review trail integrity and delivery settings.",
                "prefixes": ("cloudtrail.trail.",),
                "activation_checks": ("cloudtrail.trail.not_enabled",),
                "action_label": "Activate CloudTrail",
                "action_url": "https://console.aws.amazon.com/cloudtrail/home",
            },
            {
                "key": "config_monitoring",
                "label": "AWS Config recording",
                "verified_text": "AWS Config recording and collected rule results report no open gaps.",
                "action_text": "Enable AWS Config or review non-compliant managed rules.",
                "checks": ("aws.config.not_enabled", "aws.config.rules_non_compliant"),
                "activation_checks": ("aws.config.not_enabled",),
                "action_label": "Activate AWS Config",
                "action_url": "https://console.aws.amazon.com/config/home",
            },
            {
                "key": "network_service_logs",
                "label": "Network and service telemetry",
                "verified_text": "Applicable VPC, load-balancer, and cluster logging checks report no open gaps.",
                "checks": (
                    "vpc.flow_logs.not_enabled",
                    "elb.load_balancer.no_access_logs",
                    "eks.cluster.control_plane_logging_disabled",
                    "ecs.cluster.container_insights_disabled",
                ),
                "required_types": frozenset(
                    {"vpc", "elb_load_balancer", "eks_cluster", "ecs_cluster"}
                ),
                "resource_label": "VPC, load-balancer, EKS, or ECS resources",
                "activation_checks": ("vpc.flow_logs.not_enabled",),
                "action_text": "Enable the missing telemetry or review affected services.",
                "action_label": "Activate telemetry",
                "action_url": "https://console.aws.amazon.com/vpc/home#vpcs:",
            },
        ),
    },
    {
        "key": "identity_access",
        "label": "Identity and access",
        "question": "Is privileged and persistent access technically constrained?",
        "outcome": "Collected identity configuration is grouped into root protection, credential hygiene, and external-access review.",
        "narrative_domain_keys": ("identity_access",),
        "items": (
            {
                "key": "root_and_admin",
                "label": "Root and administrator protection",
                "verified_text": "Root MFA, root keys, and administrator-access checks report no open gaps.",
                "checks": (
                    "iam.root.no_mfa",
                    "iam.root.has_access_keys",
                    "iam.user.no_mfa",
                    "iam.user.admin_policy_attached",
                    "iam.role.least_privilege_policy",
                ),
                "action_text": "Review privileged identities and close the highest-risk access gaps.",
            },
            {
                "key": "credential_hygiene",
                "label": "Credential hygiene",
                "verified_text": "Credential age, rotation, inactivity, and password-policy checks report no open gaps.",
                "checks": (
                    "iam.user.credentials_unused_45d",
                    "iam.access_key.unused_45d",
                    "iam.access_key.no_rotation_90d",
                    "iam.access_key.multiple_active",
                    "iam.account.password_policy_weak",
                ),
                "action_text": "Review stale or weak credentials.",
            },
            {
                "key": "external_access",
                "label": "External access analysis",
                "verified_text": "IAM Access Analyzer and trust-policy checks report no open gaps.",
                "checks": (
                    "aws.access_analyzer.not_enabled",
                    "iam.role.trust_wildcard",
                    "iam.role.external_account_trust",
                ),
                "activation_checks": ("aws.access_analyzer.not_enabled",),
                "action_text": "Enable Access Analyzer or review external trust relationships.",
                "action_label": "Activate Access Analyzer",
                "action_url": "https://console.aws.amazon.com/access-analyzer/home",
            },
        ),
    },
    {
        "key": "data_protection",
        "label": "Encryption and data protection",
        "question": "Are in-scope data stores and secrets protected by configuration?",
        "outcome": "Only encryption, transport, public-access, and secret-storage settings visible to connected collectors are assessed.",
        "narrative_domain_keys": ("data_protection",),
        "items": (
            {
                "key": "encryption_at_rest",
                "label": "Encryption at rest",
                "verified_text": "Applicable S3, RDS, EBS, DynamoDB, SNS, and SQS encryption checks report no open gaps.",
                "checks": (
                    "s3.bucket.no_default_encryption",
                    "s3.bucket.no_kms",
                    "rds.instance.no_encryption",
                    "ec2.ebs.volume_unencrypted",
                    "ec2.ebs.encryption_not_default",
                    "dynamodb.table.no_encryption",
                    "sns.topic.no_encryption",
                    "sqs.queue.no_encryption",
                ),
                "required_types": frozenset(
                    {
                        "s3_bucket",
                        "rds_instance",
                        "ebs_volume",
                        "dynamodb_table",
                        "sns_topic",
                        "sqs_queue",
                    }
                ),
                "resource_label": "supported data stores",
                "action_text": "Review unencrypted data resources.",
            },
            {
                "key": "storage_access",
                "label": "Storage transport and public access",
                "verified_text": "S3 HTTPS and public-access protection checks report no open gaps.",
                "checks": (
                    "s3.bucket.no_https_policy",
                    "s3.account.public_access_not_blocked",
                    "s3.bucket.public_access_not_blocked",
                ),
                "required_types": frozenset({"s3_bucket"}),
                "resource_label": "S3 buckets",
                "action_text": "Review affected S3 policies and public-access settings.",
            },
            {
                "key": "secrets_and_keys",
                "label": "Secrets and encryption keys",
                "verified_text": "KMS rotation, key policy, secret rotation, and plaintext-secret checks report no open gaps.",
                "checks": (
                    "kms.key.no_rotation",
                    "kms.key.policy_wildcard_principal",
                    "secretsmanager.secret.no_rotation",
                    "ssm.parameter.plaintext_secret",
                ),
                "required_types": frozenset(
                    {"kms_key", "secrets_manager_secret", "ssm_parameter"}
                ),
                "resource_label": "KMS keys, Secrets Manager secrets, or SSM parameters",
                "action_text": "Review key and secret-management gaps.",
            },
        ),
    },
    {
        "key": "network_boundary",
        "label": "Network and boundary protection",
        "question": "Are internet-facing paths and resource boundaries restricted?",
        "outcome": "The result is based on collected security-group, public-endpoint, and public-resource configuration.",
        "narrative_domain_keys": ("network_boundary",),
        "items": (
            {
                "key": "internet_ingress",
                "label": "Internet ingress restrictions",
                "verified_text": "Security-group SSH, RDP, and default-group checks report no open gaps.",
                "prefixes": ("ec2.security_group.",),
                "required_types": frozenset({"security_group"}),
                "resource_label": "security groups",
                "action_text": "Review unrestricted ingress rules.",
            },
            {
                "key": "public_data_resources",
                "label": "Public data-resource exposure",
                "verified_text": "RDS, snapshot, AMI, and EBS public-exposure checks report no open gaps.",
                "checks": (
                    "rds.instance.publicly_accessible",
                    "rds.snapshot.public",
                    "ec2.ami.public",
                    "ec2.ebs.snapshot_public",
                ),
                "required_types": frozenset(
                    {"rds_instance", "rds_snapshot", "ec2_ami", "ebs_snapshot"}
                ),
                "resource_label": "RDS, AMI, or EBS snapshot resources",
                "action_text": "Review publicly exposed data resources.",
            },
            {
                "key": "public_workload_endpoints",
                "label": "Public workload endpoints",
                "verified_text": "EKS, ECS, Lambda, and load-balancer boundary checks report no open gaps.",
                "checks": (
                    "eks.cluster.public_endpoint",
                    "ecs.service.public_ip_enabled",
                    "lambda.function.public_url",
                    "elb.load_balancer.weak_tls_policy",
                ),
                "required_types": frozenset(
                    {"eks_cluster", "ecs_service", "lambda_function", "elb_load_balancer"}
                ),
                "resource_label": "EKS, ECS, Lambda, or load-balancer resources",
                "action_text": "Review public endpoints and weak transport settings.",
            },
        ),
    },
    {
        "key": "change_deployment",
        "label": "Change and deployment controls",
        "question": "Are code changes and production deployments technically gated?",
        "outcome": "This covers connected repository and runtime configuration; approvals performed outside those systems are not inferred.",
        "narrative_domain_keys": ("secure_sdlc", "change_management"),
        "items": (
            {
                "key": "branch_review",
                "label": "Protected branches and peer review",
                "verified_text": "Branch protection, reviewer, and self-merge checks report no open gaps.",
                "checks": (
                    "github.repo.no_branch_protection",
                    "gitlab.repo.no_branch_protection",
                    "github.repo.insufficient_reviews",
                    "gitlab.repo.insufficient_reviews",
                    "github.repo.self_merge_allowed",
                    "gitlab.repo.self_merge_allowed",
                ),
                "action_text": "Review repositories without enforced change review.",
            },
            {
                "key": "deployment_gates",
                "label": "Protected deployment environments",
                "verified_text": "Connected repository deployment-environment checks report no open gaps.",
                "checks": (
                    "github.repo.no_env_protection",
                    "gitlab.repo.no_env_protection",
                ),
                "action_text": "Review unprotected deployment environments.",
            },
            {
                "key": "code_security",
                "label": "Automated code and dependency checks",
                "verified_text": "Secret scanning, code scanning, and dependency-update checks report no open gaps.",
                "checks": (
                    "github.repo.secret_scanning_disabled",
                    "github.repo.code_scanning_disabled",
                    "github.repo.dependabot_disabled",
                ),
                "action_text": "Review repositories missing automated code-security checks.",
            },
        ),
    },
)

_SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}

_CHECK_RESOURCE_TYPES: tuple[tuple[str, frozenset[str], str], ...] = (
    ("rds.", frozenset({"rds_instance", "rds_snapshot"}), "RDS resources"),
    ("dynamodb.", frozenset({"dynamodb_table"}), "DynamoDB tables"),
    ("ecr.", frozenset({"ecr_repository"}), "ECR repositories"),
    (
        "ecs.",
        frozenset({"ecs_cluster", "ecs_service", "ecs_task_definition"}),
        "ECS resources",
    ),
    ("eks.", frozenset({"eks_cluster"}), "EKS clusters"),
    ("elb.", frozenset({"elb_load_balancer"}), "load balancers"),
    ("lambda.", frozenset({"lambda_function"}), "Lambda functions"),
    ("s3.bucket.", frozenset({"s3_bucket"}), "S3 buckets"),
    ("ec2.ebs.", frozenset({"ebs_volume", "ebs_snapshot"}), "EBS resources"),
    (
        "backup.plan.missing",
        frozenset({"rds_instance", "dynamodb_table", "ec2_instance", "ebs_volume"}),
        "backup-eligible resources",
    ),
)


def _fmt_date(dt: datetime) -> str:
    return dt.strftime("%Y-%b-%d")


def _resource_label(arn: str) -> str:
    if not arn or arn == "-":
        return ""
    if "/" in arn:
        return arn.rsplit("/", 1)[-1]
    if ":" in arn:
        return arn.rsplit(":", 1)[-1]
    return arn


def _org_scope_label(db: Session, org_id: uuid.UUID, primary: AwsAccount | None) -> tuple[str, str]:
    """Return (account_label, account_id) for build_domain_sections."""
    connected = db.scalars(
        select(AwsAccount)
        .where(AwsAccount.org_id == org_id, AwsAccount.status == "connected")
        .order_by(AwsAccount.label.asc())
    ).all()
    org = db.get(Org, org_id)
    org_name = (org.name if org else None) or "organization"
    if not connected:
        return org_name, "workspace"
    if len(connected) == 1:
        acc = connected[0]
        return acc.label or acc.account_id, acc.account_id
    labels = [f"{a.label or a.account_id} ({a.account_id})" for a in connected[:4]]
    extra = len(connected) - len(labels)
    joined = ", ".join(labels)
    if extra > 0:
        joined += f", and {extra} more"
    return f"{org_name} — {joined}", primary.account_id if primary else connected[0].account_id


def build_org_control_results(
    db: Session,
    org_id: uuid.UUID,
    framework: str,
    *,
    as_of: datetime | None = None,
) -> tuple[list[dict[str, Any]], AwsAccount | None, datetime]:
    """Assemble per-control results for narrative building (org readiness home scoping)."""
    generated_at = as_of or datetime.now(timezone.utc)
    if generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=timezone.utc)

    primary = db.scalars(
        select(AwsAccount)
        .where(AwsAccount.org_id == org_id, AwsAccount.status == "connected")
        .order_by(AwsAccount.label.asc())
    ).first()

    org = db.get(Org, org_id)
    hidden = hidden_check_ids(org.settings if org else {})
    mapping_index = load_org_mapping_index(db, org_id)
    active_provider_prefixes = _active_provider_prefixes(db, org_id)

    pack_findings: list[tuple[Any, str]] = []
    if primary:
        pack_findings = findings_for_pack_at(
            db, primary.id, generated_at, hidden_check_ids=set(hidden)
        )

    controls = db.scalars(
        select(Control).where(Control.framework == framework).order_by(Control.control_id)
    ).all()

    control_results: list[dict[str, Any]] = []
    for ctrl in controls:
        links = db.scalars(
            select(CheckControl.check_id).where(CheckControl.control_id == ctrl.id)
        ).all()
        check_ids = [
            cid
            for cid in effective_checks_for_control_row(
                db, org_id, ctrl, list(links), mapping_index=mapping_index
            )
            if (
                cid not in hidden
                and _check_matches_connected_scope(cid, active_provider_prefixes)
            )
        ]
        if not check_ids:
            continue
        status, hits = _control_status(pack_findings, check_ids)
        exceptions = [_finding_dict(f, state=st) for f, st in hits if st == STATE_EXCEPTED]
        open_finding_dicts = [_finding_dict(f, state=st) for f, st in hits if st == STATE_OPEN]
        control_results.append(
            {
                "control_id": ctrl.control_id,
                "title": ctrl.title,
                "status": status,
                "findings": open_finding_dicts,
                "exceptions": exceptions,
                "check_evidence_classes": {cid: "benchmark" for cid in check_ids},
            }
        )
    return control_results, primary, generated_at


def _latest_scanned_entity_types(db: Session, account_id: uuid.UUID) -> set[str] | None:
    """Entity types from the latest successful scan; None means applicability is unknown."""
    scan_id = db.scalars(
        select(ScanRun.id)
        .where(ScanRun.account_id == account_id, ScanRun.status == "ok")
        .order_by(ScanRun.finished_at.desc().nullslast(), ScanRun.started_at.desc())
        .limit(1)
    ).first()
    if not scan_id:
        return None
    return set(
        db.scalars(
            select(EvidenceSnapshot.entity_type).where(EvidenceSnapshot.scan_run_id == scan_id).distinct()
        ).all()
    )


def _latest_org_scanned_entity_types(db: Session, org_id: uuid.UUID) -> set[str] | None:
    """Union latest inventories only when every connected AWS account has a good scan."""
    account_ids = db.scalars(
        select(AwsAccount.id).where(
            AwsAccount.org_id == org_id, AwsAccount.status == "connected"
        )
    ).all()
    if not account_ids:
        return None
    entity_types: set[str] = set()
    for account_id in account_ids:
        latest = _latest_scanned_entity_types(db, account_id)
        if latest is None:
            return None
        entity_types.update(latest)
    return entity_types


def _resource_requirement(check_id: str) -> tuple[frozenset[str], str] | None:
    for prefix, required_types, label in _CHECK_RESOURCE_TYPES:
        if check_id == prefix or check_id.startswith(prefix):
            return required_types, label
    return None


def _check_has_applicable_resources(
    check_id: str,
    scanned_entity_types: set[str] | None,
    observed_check_ids: set[str],
) -> bool:
    if check_id in observed_check_ids or scanned_entity_types is None:
        return True
    requirement = _resource_requirement(check_id)
    return requirement is None or bool(scanned_entity_types & requirement[0])


def _applicability_reason(
    check_ids: list[str],
    scanned_entity_types: set[str] | None,
    observed_check_ids: set[str],
) -> str | None:
    if scanned_entity_types is None or any(cid in observed_check_ids for cid in check_ids):
        return None
    requirements = [_resource_requirement(cid) for cid in check_ids]
    if not requirements or any(requirement is None for requirement in requirements):
        return None
    required_types = set().union(*(requirement[0] for requirement in requirements if requirement))
    if scanned_entity_types & required_types:
        return None
    labels = list(dict.fromkeys(requirement[1] for requirement in requirements if requirement))
    if len(labels) == 1:
        resource_label = labels[0]
    elif len(labels) == 2:
        resource_label = f"{labels[0]} or {labels[1]}"
    else:
        resource_label = ", ".join(labels[:-1]) + f", or {labels[-1]}"
    return f"No {resource_label} in scope"


def _without_inapplicable_checks(
    control_results: list[dict[str, Any]],
    scanned_entity_types: set[str] | None,
) -> list[dict[str, Any]]:
    """Remove safely-derived N/A checks from domain readiness calculations."""
    observed_check_ids = {
        str(finding.get("check_id") or "")
        for control in control_results
        for finding in (control.get("findings") or []) + (control.get("exceptions") or [])
    }
    filtered: list[dict[str, Any]] = []
    for control in control_results:
        evidence_classes = control.get("check_evidence_classes") or {}
        applicable = {
            check_id: evidence_class
            for check_id, evidence_class in evidence_classes.items()
            if _check_has_applicable_resources(
                check_id, scanned_entity_types, observed_check_ids
            )
        }
        if not applicable:
            continue
        filtered.append({**control, "check_evidence_classes": applicable})
    return filtered


def _active_provider_prefixes(db: Session, org_id: uuid.UUID) -> set[str]:
    """Prefixes for non-AWS providers that are genuinely connected in this workspace."""
    prefixes: set[str] = set()
    if db.scalars(
        select(AwsAccount.id).where(
            AwsAccount.org_id == org_id, AwsAccount.status == "connected"
        ).limit(1)
    ).first():
        prefixes.add("__aws__")
    if db.scalars(
        select(AzureSubscription.id).where(
            AzureSubscription.org_id == org_id, AzureSubscription.status == "connected"
        ).limit(1)
    ).first():
        prefixes.update(_PROVIDER_PREFIXES["azure"])
    if db.scalars(
        select(GcpProject.id).where(GcpProject.org_id == org_id, GcpProject.status == "connected").limit(1)
    ).first():
        prefixes.update(_PROVIDER_PREFIXES["gcp"])
    providers = db.scalars(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id, IdentityProvider.status == "connected"
        )
    ).all()
    for provider in providers:
        prefixes.update(_PROVIDER_PREFIXES.get(provider.type, ()))
    return prefixes


def _check_matches_connected_scope(check_id: str, active_provider_prefixes: set[str]) -> bool:
    all_external_prefixes = tuple(
        prefix for prefixes in _PROVIDER_PREFIXES.values() for prefix in prefixes
    )
    if not check_id.startswith(all_external_prefixes):
        return "__aws__" in active_provider_prefixes
    return check_id.startswith(tuple(active_provider_prefixes)) if active_provider_prefixes else False


def _checks_for_domain(section_key: str, control_results: list[dict[str, Any]]) -> set[str]:
    checks: set[str] = set()
    for control in control_results:
        for cid in (control.get("check_evidence_classes") or {}):
            if domain_for_check(cid) == section_key:
                checks.add(cid)
        for f in (control.get("findings") or []) + (control.get("exceptions") or []):
            fcid = f.get("check_id")
            if fcid and domain_for_check(fcid) == section_key:
                checks.add(fcid)
    return checks


def _technical_playbook_items(
    playbook_def: dict[str, Any],
    control_results: list[dict[str, Any]],
    *,
    framework: str,
    named_sources: list[str],
    scanned_entity_types: set[str] | None,
) -> list[dict[str, Any]]:
    """Build only the explicitly curated technical rows for one auditor playbook."""
    check_controls: dict[str, set[str]] = {}
    gaps_by_check: dict[str, list[dict[str, Any]]] = {}
    exceptions_by_check: dict[str, list[dict[str, Any]]] = {}
    for control in control_results:
        control_id = str(control.get("control_id") or "")
        for check_id in control.get("check_evidence_classes") or {}:
            check_controls.setdefault(check_id, set()).add(control_id)
        for key, target in (("findings", gaps_by_check), ("exceptions", exceptions_by_check)):
            for finding in control.get(key) or []:
                check_id = str(finding.get("check_id") or "")
                if check_id:
                    target.setdefault(check_id, []).append(finding)
                    check_controls.setdefault(check_id, set()).add(control_id)

    observed_check_ids = set(gaps_by_check) | set(exceptions_by_check)
    items: list[dict[str, Any]] = []
    for definition in playbook_def["items"]:
        configured = set(definition.get("checks") or ())
        prefixes = tuple(definition.get("prefixes") or ())
        check_ids = sorted(
            check_id
            for check_id in check_controls
            if check_id in configured or (prefixes and check_id.startswith(prefixes))
        )
        if not check_ids:
            continue

        def dedupe_findings(source: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
            deduped: dict[str, dict[str, Any]] = {}
            for check_id in check_ids:
                for finding in source.get(check_id, []):
                    key = str(
                        finding.get("id")
                        or f"{finding.get('check_id')}::{finding.get('resource_arn')}"
                    )
                    deduped[key] = finding
            return list(deduped.values())

        gaps = dedupe_findings(gaps_by_check)
        exceptions = dedupe_findings(exceptions_by_check)
        required_types = definition.get("required_types")
        has_observed_result = any(check_id in observed_check_ids for check_id in check_ids)
        positive_evidence_gap_types = definition.get("positive_evidence_gap_types") or frozenset()
        applicability_reason: str | None = None
        inventory_unknown = False
        if required_types and not has_observed_result:
            if scanned_entity_types is None:
                inventory_unknown = True
            elif not scanned_entity_types.intersection(required_types):
                applicability_reason = (
                    f"No {definition['resource_label']} in the latest complete inventory"
                )
            elif scanned_entity_types.intersection(positive_evidence_gap_types):
                inventory_unknown = True

        state = "not_applicable" if applicability_reason else "action" if gaps or inventory_unknown else "verified"
        ranked_gaps = sorted(
            gaps,
            key=lambda finding: (
                _SEVERITY_ORDER.get(str(finding.get("severity") or "").lower(), 9),
                str(finding.get("title") or ""),
            ),
        )
        highest_severity = str(ranked_gaps[0].get("severity") or "").lower() if ranked_gaps else None
        resources = sorted(
            {
                _resource_label(str(entry.get("resource_arn") or ""))
                for entry in gaps + exceptions
                if _resource_label(str(entry.get("resource_arn") or ""))
            }
        )
        activation_checks = set(definition.get("activation_checks") or ())
        activate = bool(
            activation_checks
            and any(str(finding.get("check_id") or "") in activation_checks for finding in gaps)
        )
        if inventory_unknown:
            summary = (
                "Review Inspector coverage for EC2; the current automated check cannot distinguish "
                "enabled-with-zero-findings from disabled."
                if scanned_entity_types
                and scanned_entity_types.intersection(positive_evidence_gap_types)
                else (
                    f"Review applicability: no complete latest inventory is available for "
                    f"{definition['resource_label']}."
                )
            )
            action_kind = "review"
            action_label = "Review scan coverage"
            action_url = None
        elif state == "not_applicable":
            summary = applicability_reason
            action_kind = None
            action_label = None
            action_url = None
        elif state == "verified":
            summary = definition["verified_text"]
            action_kind = None
            action_label = None
            action_url = None
        else:
            summary = definition["action_text"]
            action_kind = "activate" if activate else "review"
            action_label = (
                definition.get("action_label") if activate else "Review findings"
            )
            action_url = definition.get("action_url") if activate else None
        items.append(
            {
                "key": definition["key"],
                "check_ids": check_ids,
                "label": definition["label"],
                "status": state,
                "summary": summary,
                "controls": [
                    _framework_control_tag(framework, control_id)
                    for control_id in sorted(
                        {control for check_id in check_ids for control in check_controls[check_id]}
                    )
                    if control_id
                ],
                "sources": resources or named_sources,
                "finding_count": len(gaps),
                "exception_count": len(exceptions),
                "highest_severity": highest_severity,
                "applicability_reason": applicability_reason,
                "action_kind": action_kind,
                "action_label": action_label,
                "action_url": action_url,
            }
        )
    return items


def _build_technical_playbooks(
    control_results: list[dict[str, Any]],
    *,
    framework: str,
    account: AwsAccount | None,
    scanned_entity_types: set[str] | None,
) -> list[dict[str, Any]]:
    """Return concise auditor outcomes; never synthesize rows from unknown check ids."""
    playbooks: list[dict[str, Any]] = []
    for definition in _AUDITOR_TECHNICAL_PLAYBOOKS:
        named_sources = sorted(
            {
                source
                for domain_key in definition["narrative_domain_keys"]
                for source in _named_sources_for_domain(
                    domain_key, control_results, account=account
                )
            }
        )
        all_items = _technical_playbook_items(
            definition,
            control_results,
            framework=framework,
            named_sources=named_sources,
            scanned_entity_types=scanned_entity_types,
        )
        if not all_items:
            continue
        action_items = [item for item in all_items if item["status"] == "action"]
        included_action_keys = {item["key"] for item in action_items[:3]}
        items = [
            item
            for item in all_items
            if item["status"] != "action" or item["key"] in included_action_keys
        ]
        additional_action_count = max(0, len(action_items) - 3)
        if action_items:
            status = "action"
        elif all(item["status"] == "not_applicable" for item in all_items):
            status = "not_applicable"
        else:
            status = "verified"
        playbooks.append(
            {
                "key": definition["key"],
                "label": definition["label"],
                "question": definition["question"],
                "outcome": definition["outcome"],
                "status": status,
                "items": items,
                "additional_action_count": additional_action_count,
                "controls": sorted(
                    {control for item in all_items for control in item["controls"]}
                ),
                "narrative_domain_keys": list(definition["narrative_domain_keys"]),
            }
        )
    return playbooks


def _framework_control_tag(framework: str, control_id: str) -> str:
    if framework == "soc2":
        return f"SOC 2 {control_id}"
    if framework == "iso27001":
        return f"ISO 27001 {control_id}"
    if framework == "cis_aws_l1":
        return f"CIS AWS {control_id}"
    return control_id


def _named_sources_for_domain(
    section_key: str,
    control_results: list[dict[str, Any]],
    *,
    account: AwsAccount | None,
) -> list[str]:
    sources: list[str] = []
    if account and section_key != "secure_sdlc":
        label = account.label or account.account_id
        sources.append(f"AWS account {label} ({account.account_id})")
    repos: set[str] = set()
    services: set[str] = set()
    for control in control_results:
        for f in (control.get("findings") or []) + (control.get("exceptions") or []):
            cid = f.get("check_id") or ""
            if domain_for_check(cid) != section_key:
                continue
            arn = f.get("resource_arn") or ""
            if cid.startswith(("github.", "gitlab.")):
                name = _resource_label(arn)
                if name:
                    repos.add(name)
            elif cid.startswith("aws.inspector"):
                services.add("AWS Inspector")
            elif cid.startswith("aws.vulnerability_monitoring"):
                services.add("vulnerability monitoring")
            elif cid.startswith("backup."):
                services.add("AWS Backup")
            elif cid.startswith("rds."):
                services.add("RDS")
    if services:
        sources.append(", ".join(sorted(services)))
    if repos:
        shown = sorted(repos)[:6]
        suffix = f" and {len(repos) - len(shown)} more" if len(repos) > len(shown) else ""
        sources.append(f"{len(repos)} repository/repos ({', '.join(shown)}{suffix})")
    return sources


def _resolved_events_in_period(
    db: Session,
    *,
    account_id: uuid.UUID | None,
    check_ids: set[str],
    since: datetime,
    until: datetime,
) -> list[tuple[FindingEvent, Finding]]:
    if not check_ids:
        return []
    q = (
        select(FindingEvent, Finding)
        .join(Finding, FindingEvent.finding_id == Finding.id)
        .where(
            FindingEvent.action == "resolved",
            FindingEvent.ts >= since,
            FindingEvent.ts <= until,
            Finding.check_id.in_(check_ids),
        )
        .order_by(FindingEvent.ts.desc())
    )
    if account_id:
        q = q.where(with_source_control_for_audit(Finding.account_id == account_id))
    return list(db.execute(q).all())


def _control_ids_for_domain(domain_def: dict[str, Any], control_results: list[dict[str, Any]]) -> list[str]:
    domain_checks = _checks_for_domain(domain_def["key"], control_results)
    if not domain_checks:
        return []
    out: list[str] = []
    for control in control_results:
        mapped = set((control.get("check_evidence_classes") or {}).keys())
        if mapped & domain_checks:
            cid = control.get("control_id")
            if cid:
                out.append(cid)
    return out


def _temporal_from_control_history(
    db: Session,
    account_id: uuid.UUID,
    framework: str,
    control_ids: list[str],
    *,
    days: int,
    domain_label: str,
) -> str | None:
    for control_id in control_ids[:8]:
        try:
            hist = build_control_history(db, account_id, framework, control_id, days)
        except ValueError:
            continue
        segments = hist.get("segments") or []
        fail_span = next((s for s in segments if s.get("status") == "fail"), None)
        if not fail_span:
            continue
        if hist.get("current_status") != "pass":
            fail_from = str(fail_span.get("from", ""))[:10]
            return (
                f"{domain_label} has been failing since {fail_from}; "
                f"{hist.get('open_finding_count', 0)} open finding(s) remain."
            )
        pass_after = next(
            (s for s in segments if s.get("status") == "pass" and s.get("from", "") >= fail_span.get("to", "")),
            None,
        )
        if pass_after:
            fail_from = str(fail_span.get("from", ""))[:10]
            fail_to = str(fail_span.get("to", ""))[:10]
            pass_since = str(pass_after.get("from", ""))[:10]
            return (
                f"{domain_label} was failing {fail_from}–{fail_to}; "
                f"remediated and passing since {pass_since}."
            )
    return None


def build_domain_temporal_sentence(
    db: Session,
    *,
    account: AwsAccount | None,
    framework: str,
    domain_def: dict[str, Any],
    control_results: list[dict[str, Any]],
    since: datetime,
    until: datetime,
    period_days: int,
) -> str | None:
    """One in-period trend/remediation sentence when a material change exists."""
    key = domain_def["key"]
    check_ids = _checks_for_domain(key, control_results)
    if not check_ids:
        return None

    resolved = _resolved_events_in_period(
        db,
        account_id=account.id if account else None,
        check_ids=check_ids,
        since=since,
        until=until,
    )

    if key == "vulnerability_management" and resolved:
        critical = [pair for pair in resolved if (pair[1].severity or "").lower() == "critical"]
        if critical:
            latest = critical[0][0].ts
            open_critical = sum(
                1
                for control in control_results
                for f in control.get("findings") or []
                if f.get("check_id") in _VULN_CHECKS
                and str(f.get("severity", "")).lower() == "critical"
            )
            remediated = len(critical)
            prior = open_critical + remediated
            return (
                f"On {_fmt_date(latest)}, {remediated} critical vulnerabilit"
                f"{'y' if remediated == 1 else 'ies'} remediated, reducing critical count "
                f"from {prior} to {open_critical}."
            )

    if key == "secure_sdlc":
        passing_checks = set()
        for control in control_results:
            for cid in (control.get("check_evidence_classes") or {}):
                if domain_for_check(cid) == key and cid in _SDLC_CHECKS:
                    if not any(f.get("check_id") == cid for f in control.get("findings") or []):
                        passing_checks.add(cid)
        if passing_checks:
            repos = {
                _resource_label(f.get("resource_arn") or "")
                for control in control_results
                for f in (control.get("findings") or []) + (control.get("exceptions") or [])
                if (f.get("check_id") or "").startswith(("github.", "gitlab."))
            }
            repo_count = len({r for r in repos if r}) or None
            parts = []
            if "github.repo.no_branch_protection" in passing_checks or "gitlab.repo.no_branch_protection" in passing_checks:
                parts.append("default branch protection enforced")
            if "github.repo.dependabot_disabled" in passing_checks:
                parts.append("Dependabot enabled")
            if parts:
                repo_phrase = f" across {repo_count} repositories" if repo_count else ""
                return f"SDLC controls verified: {' and '.join(parts)}{repo_phrase}."

    if key == "backup_dr":
        open_gaps = sum(
            1
            for control in control_results
            for f in control.get("findings") or []
            if domain_for_check(f.get("check_id") or "") == key
        )
        passing_dr = any(
            domain_for_check(cid) == key
            for control in control_results
            for cid in (control.get("check_evidence_classes") or {})
            if not any(f.get("check_id") == cid for f in control.get("findings") or [])
        )
        if open_gaps and passing_dr:
            return (
                "Backup and disaster recovery is in progress — some automated checks verified "
                f"while {open_gaps} open gap(s) remain in this domain."
            )

    if resolved:
        latest = resolved[0][0].ts
        count = len(resolved)
        return (
            f"On {_fmt_date(latest)}, {count} finding"
            f"{'' if count == 1 else 's'} in this domain remediated during the audit period."
        )

    if account:
        control_ids = _control_ids_for_domain(domain_def, control_results)
        hist_sentence = _temporal_from_control_history(
            db,
            account.id,
            framework,
            control_ids,
            days=period_days,
            domain_label=domain_def["label"],
        )
        if hist_sentence:
            return hist_sentence
    return None


def build_audit_readiness(
    db: Session,
    org_id: uuid.UUID,
    framework: str,
    *,
    period_days: int = 90,
) -> dict[str, Any]:
    """Structured org-wide audit readiness payload."""
    control_results, account, generated_at = build_org_control_results(db, org_id, framework)
    scanned_entity_types = _latest_org_scanned_entity_types(db, org_id)
    applicable_control_results = _without_inapplicable_checks(
        control_results, scanned_entity_types
    )
    account_label, account_id_str = _org_scope_label(db, org_id, account)
    since = generated_at - timedelta(days=period_days)

    sections = build_domain_sections(
        applicable_control_results,
        framework=framework,
        account_label=account_label,
        account_id=account_id_str,
        generated_at=generated_at,
    )

    sections_by_key = {section.key: section for section in sections}
    domains: list[dict[str, Any]] = []
    for domain_def in DOMAIN_DEFS:
        key = domain_def["key"]
        section = sections_by_key.get(key)
        if not section:
            continue
        named_sources = _named_sources_for_domain(key, control_results, account=account)
        temporal = build_domain_temporal_sentence(
            db,
            account=account,
            framework=framework,
            domain_def=domain_def,
            control_results=applicable_control_results,
            since=since,
            until=generated_at,
            period_days=period_days,
        )
        check_ids = sorted(_checks_for_domain(key, applicable_control_results))
        domains.append(
            domain_section_as_dict(
                section,
                temporal_sentence=temporal,
                named_sources=named_sources,
                check_ids=check_ids,
            )
        )

    org = db.get(Org, org_id)
    return {
        "framework": framework,
        "org_name": (org.name if org else None) or "Organization",
        "as_of": generated_at.isoformat(),
        "period_days": period_days,
        "scope_label": account_label,
        "playbooks": _build_technical_playbooks(
            control_results,
            framework=framework,
            account=account,
            scanned_entity_types=scanned_entity_types,
        ),
        "domains": domains,
    }
