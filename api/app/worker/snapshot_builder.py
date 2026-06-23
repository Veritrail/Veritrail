"""Schema-driven evidence snapshot builder.

Replaces ~40 copy-pasted EvidenceSnapshot(...) blocks in tasks.py with a
single data-driven loop. Adding a new entity type now requires one line in
_SNAPSHOT_SCHEMA instead of 10 lines of boilerplate.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import EvidenceSnapshot, ScanRun
from app.models import AwsAccount

# Import all resource models used in snapshots
from app.models.iam import IamUser, IamAccessKey, IamRole
from app.models.resources import (
    IamPasswordPolicy,
    S3Bucket,
    S3AccountPublicAccessBlock,
    KmsKey,
    CloudTrailTrail,
    GuardDutyDetector,
    GuardDutyFinding,
    AccessAnalyzer,
    ConfigRecorder,
    SecurityHubStatus,
    Vpc,
    SecurityGroup,
    Ec2Instance,
    EbsVolume,
    EbsEncryptionDefault,
    RdsInstance,
    RdsSnapshot,
    EbsSnapshot,
    Ec2Ami,
    EksCluster,
    IdentityCenterUser,
    ConfigRuleCompliance,
    AcmCertificate,
    LambdaFunction,
    EcrRepository,
    EcsCluster,
    EcsService,
    SecretsManagerSecret,
    SsmParameter,
    ElbLoadBalancer,
    DynamoDbTable,
    SnsTopic,
    SqsQueue,
)


@dataclass(frozen=True)
class SnapshotSpec:
    """Defines how to snapshot one entity type."""
    entity_type: str
    model: type
    entity_id: Callable[[Any], str]  # lambda row: str
    payload: Callable[[Any], dict]   # lambda row: dict


def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


# ---------------------------------------------------------------------------
# Schema: one line per entity type.  Add new types here — no more copy-paste.
# ---------------------------------------------------------------------------
_SNAPSHOT_SCHEMA: list[SnapshotSpec] = [
    SnapshotSpec(
        entity_type="iam_user",
        model=IamUser,
        entity_id=lambda r: r.arn,
        payload=lambda r: {
            "username": r.name,
            "arn": r.arn,
            "has_console_password": r.has_console_password,
            "mfa_active": r.mfa_enabled,
            "attached_policies": r.attached_policies or [],
            "inline_policy_names": list((r.inline_policies or {}).keys()),
            "last_used_at": _iso(r.password_last_used),
            "created_at": _iso(r.created),
        },
    ),
    SnapshotSpec(
        entity_type="iam_access_key",
        model=IamAccessKey,
        entity_id=lambda r: r.key_id,
        payload=lambda r: {
            "access_key_id": r.key_id,
            "user_arn": r.user_arn,
            "status": r.status,
            "created_at": _iso(r.created),
            "last_used_at": _iso(r.last_used),
        },
    ),
    SnapshotSpec(
        entity_type="iam_role",
        model=IamRole,
        entity_id=lambda r: r.arn,
        payload=lambda r: {
            "role_name": r.name,
            "arn": r.arn,
            "last_used_at": _iso(r.last_assumed),
            "created_at": _iso(r.created),
            "trust_policy": r.trust_policy,
        },
    ),
    SnapshotSpec(
        entity_type="s3_bucket",
        model=S3Bucket,
        entity_id=lambda r: r.arn,
        payload=lambda r: {
            "name": r.name,
            "arn": r.arn,
            "logging_enabled": r.logging_enabled,
            "encrypted": r.encrypted,
            "kms_encrypted": r.kms_encrypted,
            "versioning_enabled": r.versioning_enabled,
            "public_access_blocked": r.public_access_blocked,
            "https_only": r.https_only,
        },
    ),
    SnapshotSpec(
        entity_type="s3_account_public_access_block",
        model=S3AccountPublicAccessBlock,
        entity_id=lambda r: str(r.account_id),
        payload=lambda r: {
            "block_public_acls": r.block_public_acls,
            "ignore_public_acls": r.ignore_public_acls,
            "block_public_policy": r.block_public_policy,
            "restrict_public_buckets": r.restrict_public_buckets,
            "all_blocked": r.all_blocked,
        },
    ),
    SnapshotSpec(
        entity_type="kms_key",
        model=KmsKey,
        entity_id=lambda r: r.arn,
        payload=lambda r: {
            "key_id": r.key_id,
            "arn": r.arn,
            "alias": r.alias,
            "rotation_enabled": r.rotation_enabled,
            "key_state": r.key_state,
            "has_wildcard_principal": r.has_wildcard_principal,
        },
    ),
    SnapshotSpec(
        entity_type="iam_password_policy",
        model=IamPasswordPolicy,
        entity_id=lambda r: str(r.account_id),
        payload=lambda r: {
            "exists": r.exists,
            "min_length": r.min_length,
            "require_uppercase": r.require_uppercase,
            "require_lowercase": r.require_lowercase,
            "require_numbers": r.require_numbers,
            "require_symbols": r.require_symbols,
            "max_age": r.max_age,
            "password_reuse_prevention": r.password_reuse_prevention,
        },
    ),
    SnapshotSpec(
        entity_type="cloudtrail_trail",
        model=CloudTrailTrail,
        entity_id=lambda r: r.arn,
        payload=lambda r: {
            "name": r.name,
            "arn": r.arn,
            "home_region": r.home_region,
            "is_multi_region": r.is_multi_region,
            "is_logging": r.is_logging,
            "log_validation_enabled": r.log_validation_enabled,
            "kms_key_id": r.kms_key_id,
        },
    ),
    SnapshotSpec(
        entity_type="guardduty_detector",
        model=GuardDutyDetector,
        entity_id=lambda r: f"{r.region}:{r.detector_id}",
        payload=lambda r: {
            "detector_id": r.detector_id,
            "region": r.region,
            "status": r.status,
        },
    ),
    SnapshotSpec(
        entity_type="access_analyzer",
        model=AccessAnalyzer,
        entity_id=lambda r: f"{r.region}:{r.analyzer_name or 'none'}",
        payload=lambda r: {
            "region": r.region,
            "analyzer_name": r.analyzer_name,
            "status": r.status,
        },
    ),
    SnapshotSpec(
        entity_type="config_recorder",
        model=ConfigRecorder,
        entity_id=lambda r: f"{r.region}:{r.recorder_name or 'none'}",
        payload=lambda r: {
            "region": r.region,
            "recorder_name": r.recorder_name,
            "recording": r.recording,
            "delivery_channel_exists": r.delivery_channel_exists,
        },
    ),
    SnapshotSpec(
        entity_type="security_hub",
        model=SecurityHubStatus,
        entity_id=lambda r: f"{r.region}:{r.hub_arn or 'disabled'}",
        payload=lambda r: {
            "region": r.region,
            "hub_arn": r.hub_arn,
            "enabled": r.enabled,
        },
    ),
    SnapshotSpec(
        entity_type="vpc",
        model=Vpc,
        entity_id=lambda r: f"{r.region}:{r.vpc_id}",
        payload=lambda r: {
            "vpc_id": r.vpc_id,
            "region": r.region,
            "flow_logs_enabled": r.flow_logs_enabled,
        },
    ),
    SnapshotSpec(
        entity_type="security_group",
        model=SecurityGroup,
        entity_id=lambda r: f"{r.region}:{r.group_id}",
        payload=lambda r: {
            "group_id": r.group_id,
            "group_name": r.group_name,
            "region": r.region,
            "vpc_id": r.vpc_id,
            "is_default": r.is_default,
            "unrestricted_ssh": r.unrestricted_ssh,
            "unrestricted_rdp": r.unrestricted_rdp,
            "has_any_inbound_rules": r.has_any_inbound_rules,
            "has_any_outbound_rules": r.has_any_outbound_rules,
        },
    ),
    SnapshotSpec(
        entity_type="ec2_instance",
        model=Ec2Instance,
        entity_id=lambda r: f"{r.region}:{r.instance_id}",
        payload=lambda r: {
            "instance_id": r.instance_id,
            "region": r.region,
            "instance_type": r.instance_type,
            "state": r.state,
            "imdsv2_required": r.imdsv2_required,
            "vpc_id": r.vpc_id,
            "subnet_id": r.subnet_id,
            "security_group_ids": r.security_group_ids,
            "tags": r.tags,
        },
    ),
    SnapshotSpec(
        entity_type="ebs_volume",
        model=EbsVolume,
        entity_id=lambda r: r.arn,
        payload=lambda r: {
            "volume_id": r.volume_id,
            "arn": r.arn,
            "region": r.region,
            "encrypted": r.encrypted,
            "state": r.state,
            "size_gib": r.size_gib,
            "volume_type": r.volume_type,
            "attached_instance_ids": r.attached_instance_ids,
        },
    ),
    SnapshotSpec(
        entity_type="ebs_encryption_default",
        model=EbsEncryptionDefault,
        entity_id=lambda r: r.region,
        payload=lambda r: {
            "region": r.region,
            "enabled": r.enabled,
        },
    ),
    SnapshotSpec(
        entity_type="rds_instance",
        model=RdsInstance,
        entity_id=lambda r: r.arn,
        payload=lambda r: {
            "db_instance_id": r.db_instance_id,
            "arn": r.arn,
            "region": r.region,
            "publicly_accessible": r.publicly_accessible,
            "storage_encrypted": r.storage_encrypted,
            "backup_retention_period": r.backup_retention_period,
            "engine": r.engine,
            "multi_az": r.multi_az,
            "deletion_protection": r.deletion_protection,
        },
    ),
    SnapshotSpec(
        entity_type="rds_snapshot",
        model=RdsSnapshot,
        entity_id=lambda r: r.arn,
        payload=lambda r: {
            "snapshot_id": r.snapshot_id,
            "arn": r.arn,
            "region": r.region,
            "engine": r.engine,
            "encrypted": r.encrypted,
            "is_public": r.is_public,
        },
    ),
    SnapshotSpec(
        entity_type="ebs_snapshot",
        model=EbsSnapshot,
        entity_id=lambda r: r.arn,
        payload=lambda r: {
            "snapshot_id": r.snapshot_id,
            "arn": r.arn,
            "region": r.region,
            "encrypted": r.encrypted,
            "is_public": r.is_public,
        },
    ),
    SnapshotSpec(
        entity_type="ec2_ami",
        model=Ec2Ami,
        entity_id=lambda r: r.arn,
        payload=lambda r: {
            "image_id": r.image_id,
            "arn": r.arn,
            "region": r.region,
            "name": r.name,
            "is_public": r.is_public,
            "created_at": _iso(r.created_at),
        },
    ),
    SnapshotSpec(
        entity_type="eks_cluster",
        model=EksCluster,
        entity_id=lambda r: r.arn,
        payload=lambda r: {
            "name": r.name,
            "arn": r.arn,
            "region": r.region,
            "endpoint_public_access": r.endpoint_public_access,
            "endpoint_private_access": r.endpoint_private_access,
            "public_access_cidrs": r.public_access_cidrs or [],
            "version": r.version,
            "status": r.status,
        },
    ),
    SnapshotSpec(
        entity_type="guardduty_finding",
        model=GuardDutyFinding,
        entity_id=lambda r: f"{r.region}:{r.finding_id}",
        payload=lambda r: {
            "region": r.region,
            "finding_id": r.finding_id,
            "severity": r.severity,
            "title": r.title,
            "finding_type": r.finding_type,
            "archived": r.archived,
        },
    ),
    SnapshotSpec(
        entity_type="identity_center_user",
        model=IdentityCenterUser,
        entity_id=lambda r: f"{r.identity_store_id}:{r.user_id}",
        payload=lambda r: {
            "user_id": r.user_id,
            "user_name": r.user_name,
            "display_name": r.display_name,
            "email": r.email,
            "active": r.active,
        },
    ),
    SnapshotSpec(
        entity_type="config_rule_compliance",
        model=ConfigRuleCompliance,
        entity_id=lambda r: f"{r.region}:{r.rule_name}",
        payload=lambda r: {
            "region": r.region,
            "rule_name": r.rule_name,
            "compliance_type": r.compliance_type,
        },
    ),
    SnapshotSpec(
        entity_type="acm_certificate",
        model=AcmCertificate,
        entity_id=lambda r: r.certificate_arn,
        payload=lambda r: {
            "certificate_arn": r.certificate_arn,
            "region": r.region,
            "domain_name": r.domain_name,
            "expires_at": _iso(r.expires_at),
            "status": r.status,
        },
    ),
    SnapshotSpec(
        entity_type="lambda_function",
        model=LambdaFunction,
        entity_id=lambda r: r.arn,
        payload=lambda r: {
            "function_name": r.function_name,
            "arn": r.arn,
            "region": r.region,
            "runtime": r.runtime,
            "has_dlq": r.has_dlq,
            "function_url": r.function_url,
            "function_url_auth_type": r.function_url_auth_type,
        },
    ),
    SnapshotSpec(
        entity_type="ecr_repository",
        model=EcrRepository,
        entity_id=lambda r: r.repository_arn,
        payload=lambda r: {
            "repository_name": r.repository_name,
            "repository_arn": r.repository_arn,
            "region": r.region,
            "scan_on_push": r.scan_on_push,
            "encryption_type": r.encryption_type,
        },
    ),
    SnapshotSpec(
        entity_type="ecs_cluster",
        model=EcsCluster,
        entity_id=lambda r: r.arn,
        payload=lambda r: {
            "cluster_name": r.name,
            "region": r.region,
            "container_insights_enabled": r.container_insights_enabled,
            "status": r.status,
        },
    ),
    SnapshotSpec(
        entity_type="ecs_service",
        model=EcsService,
        entity_id=lambda r: r.service_arn,
        payload=lambda r: {
            "service_name": r.service_name,
            "cluster_name": r.cluster_name,
            "region": r.region,
            "assign_public_ip": r.assign_public_ip,
            "launch_type": r.launch_type,
            "status": r.status,
            "task_definition_arn": r.task_definition_arn,
        },
    ),
    SnapshotSpec(
        entity_type="secrets_manager_secret",
        model=SecretsManagerSecret,
        entity_id=lambda r: r.secret_arn,
        payload=lambda r: {
            "name": r.name,
            "secret_arn": r.secret_arn,
            "region": r.region,
            "rotation_enabled": r.rotation_enabled,
        },
    ),
    SnapshotSpec(
        entity_type="ssm_parameter",
        model=SsmParameter,
        entity_id=lambda r: f"{r.region}:{r.parameter_name}",
        payload=lambda r: {
            "parameter_name": r.parameter_name,
            "region": r.region,
            "parameter_type": r.parameter_type,
        },
    ),
    SnapshotSpec(
        entity_type="elb_load_balancer",
        model=ElbLoadBalancer,
        entity_id=lambda r: r.load_balancer_arn,
        payload=lambda r: {
            "name": r.name,
            "load_balancer_arn": r.load_balancer_arn,
            "region": r.region,
            "lb_type": r.lb_type,
            "access_logs_enabled": r.access_logs_enabled,
            "ssl_policy": r.ssl_policy,
        },
    ),
    SnapshotSpec(
        entity_type="dynamodb_table",
        model=DynamoDbTable,
        entity_id=lambda r: r.arn,
        payload=lambda r: {
            "table_name": r.table_name,
            "arn": r.arn,
            "region": r.region,
            "pitr_enabled": r.pitr_enabled,
            "kms_encrypted": r.kms_encrypted,
        },
    ),
    SnapshotSpec(
        entity_type="sns_topic",
        model=SnsTopic,
        entity_id=lambda r: r.topic_arn,
        payload=lambda r: {
            "topic_arn": r.topic_arn,
            "region": r.region,
            "kms_encrypted": r.kms_encrypted,
        },
    ),
    SnapshotSpec(
        entity_type="sqs_queue",
        model=SqsQueue,
        entity_id=lambda r: r.queue_arn,
        payload=lambda r: {
            "queue_arn": r.queue_arn,
            "queue_url": r.queue_url,
            "region": r.region,
            "kms_encrypted": r.kms_encrypted,
        },
    ),
]


def build_snapshots_from_schema(
    db: Session,
    acc: AwsAccount,
    run: ScanRun,
) -> list[EvidenceSnapshot]:
    """Return EvidenceSnapshot rows for every entity in _SNAPSHOT_SCHEMA."""
    snaps: list[EvidenceSnapshot] = []
    for spec in _SNAPSHOT_SCHEMA:
        for row in db.scalars(select(spec.model).where(spec.model.account_id == acc.id)).all():
            snaps.append(
                EvidenceSnapshot(
                    id=uuid.uuid4(),
                    scan_run_id=run.id,
                    account_id=acc.id,
                    org_id=acc.org_id,
                    entity_type=spec.entity_type,
                    entity_id=spec.entity_id(row),
                    payload_json=spec.payload(row),
                )
            )
    return snaps
