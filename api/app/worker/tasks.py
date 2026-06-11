from __future__ import annotations

import traceback
import uuid
from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import func, select

from app.checks.persist import persist_findings
from app.checks.registry import ALL_CHECKS
from app.checks import role_unused_services
from app.collectors.account_governance import collect_account_governance
from app.collectors.iam import collect_iam
from app.collectors.iam_server_certificates import collect_iam_server_certificates
from app.collectors.last_accessed import collect_perm_usage
from app.collectors.account import collect_s3, collect_s3_account_public_access_block, collect_kms
from app.collectors.cloudtrail import collect_cloudtrail
from app.collectors.cloudtrail_events import collect_cloudtrail_events
from app.collectors.guardduty import collect_guardduty
from app.collectors.guardduty_findings import collect_guardduty_findings
from app.collectors.identity_center import collect_identity_center, list_permission_set_snapshots
from app.collectors.config_compliance import collect_config_compliance
from app.collectors.vpc import collect_vpc
from app.collectors.rds import collect_rds
from app.collectors.eks import collect_eks
from app.collectors.ecs import collect_ecs
from app.collectors.ecr_registry import collect_ecr_registry_settings
from app.collectors.inspector import collect_inspector
from app.collectors.ec2 import collect_ec2
from app.collectors.extended import (
    collect_acm,
    collect_dynamodb,
    collect_ecr,
    collect_elb,
    collect_lambda,
    collect_secrets,
    collect_sns,
    collect_sqs,
    collect_ssm_parameters,
)
from app.collectors.access_analyzer import collect_access_analyzer
from app.collectors.config_service import collect_config_service
from app.collectors.securityhub import collect_securityhub
from app.core.aws import assume_role
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models import AssumeRoleAudit, AwsAccount, ScanRun, EvidenceSnapshot, Finding
from app.models.iam import IamUser, IamAccessKey, IamRole
from app.models.resources import (
    AccessAnalyzer,
    AcmCertificate,
    CloudTrailTrail,
    ConfigRecorder,
    DynamoDbTable,
    EcrRepository,
    EcrRegistrySettings,
    EbsEncryptionDefault,
    EbsSnapshot,
    EbsVolume,
    Ec2Ami,
    Ec2Instance,
    EcsCluster,
    EcsService,
    EcsTaskDefinition,
    EksCluster,
    ElbLoadBalancer,
    GuardDutyDetector,
    GuardDutyFinding,
    InspectorAccountStatus,
    InspectorFinding,
    IdentityCenterUser,
    ConfigRuleCompliance,
    IamPasswordPolicy,
    KmsKey,
    LambdaFunction,
    RdsInstance,
    RdsSnapshot,
    S3AccountPublicAccessBlock,
    S3Bucket,
    SecretsManagerSecret,
    SecurityGroup,
    SecurityHubStatus,
    SnsTopic,
    SqsQueue,
    SsmParameter,
    Vpc,
)
from app.models.org import Org, User
from app.worker.celery_app import celery_app

# maps check_id prefix → collector function(db, acc)
# More-specific prefixes must come before less-specific ones
_COLLECTOR_FOR_CHECK = {
    "iam.server_certificate.": lambda db, acc: collect_iam_server_certificates(db, acc),
    "iam.": lambda db, acc: collect_iam(db, acc),
    "aws.account.": lambda db, acc: collect_account_governance(db, acc),
    "s3.account.": lambda db, acc: collect_s3_account_public_access_block(db, acc),
    "s3.": lambda db, acc: collect_s3(db, acc),
    "kms.": lambda db, acc: collect_kms(db, acc),
    "cloudtrail.": lambda db, acc: collect_cloudtrail(db, acc),
    "guardduty.": lambda db, acc: collect_guardduty(db, acc),
    "aws.identity": lambda db, acc: collect_identity_center(db, acc),
    "identity_center.user.": lambda db, acc: collect_identity_center(db, acc),
    "aws.access_analyzer.": lambda db, acc: collect_access_analyzer(db, acc),
    "aws.config.": lambda db, acc: collect_config_service(db, acc),
    "aws.securityhub.": lambda db, acc: collect_securityhub(db, acc),
    "vpc.": lambda db, acc: collect_vpc(db, acc),
    "ec2.ami.": lambda db, acc: collect_ec2(db, acc),
    "ec2.security_group.": lambda db, acc: collect_vpc(db, acc),
    "ec2.instance.": lambda db, acc: collect_ec2(db, acc),
    "ec2.ebs.": lambda db, acc: collect_ec2(db, acc),
    "acm.": lambda db, acc: collect_acm(db, acc),
    "lambda.": lambda db, acc: collect_lambda(db, acc),
    "secretsmanager.": lambda db, acc: collect_secrets(db, acc),
    "ssm.": lambda db, acc: collect_ssm_parameters(db, acc),
    "elb.": lambda db, acc: collect_elb(db, acc),
    "dynamodb.": lambda db, acc: collect_dynamodb(db, acc),
    "ecr.": lambda db, acc: collect_ecr(db, acc),
    "eks.": lambda db, acc: collect_eks(db, acc),
    "ecs.": lambda db, acc: collect_ecs(db, acc),
    "aws.inspector.": lambda db, acc: collect_inspector(db, acc),
    "aws.vulnerability_monitoring.": lambda db, acc: collect_inspector(db, acc),
    "sns.": lambda db, acc: collect_sns(db, acc),
    "sqs.": lambda db, acc: collect_sqs(db, acc),
    "rds.": lambda db, acc: collect_rds(db, acc),
}

_CHECK_BY_ID = {mod.CHECK_ID: mod for mod in ALL_CHECKS}

log = structlog.get_logger()


def _enqueue_post_scan_tasks(account_id: str) -> None:
    """Queue non-critical follow-up work without changing scan outcome."""
    try:
        collect_perm_usage_task.delay(account_id)
    except Exception:  # noqa: BLE001
        log.exception("scan.followup_enqueue_failed", account_id=account_id, task="collect_perm_usage")

    settings = get_settings()
    if not settings.AI_TRIAGE_ENABLED:
        return
    try:
        ai_triage_task.delay(account_id)
    except Exception:  # noqa: BLE001
        log.exception("scan.followup_enqueue_failed", account_id=account_id, task="ai_triage")

def _write_evidence_snapshots(db, acc: AwsAccount, run: ScanRun) -> int:
    """Snapshot all collected entities for this scan run into evidence_snapshots."""
    snaps = []

    if acc.role_arn and acc.external_id:
        try:
            sess = assume_role(
                acc.role_arn,
                acc.external_id,
                session_name="vigil-account-summary",
                aws_account=acc,
                purpose="evidence_snapshot_account_summary",
            )
            summary_map = sess.client("iam").get_account_summary()["SummaryMap"]
            snaps.append(
                EvidenceSnapshot(
                    id=uuid.uuid4(),
                    scan_run_id=run.id,
                    account_id=acc.id,
                    org_id=acc.org_id,
                    entity_type="account_summary",
                    entity_id=f"arn:aws:iam::{acc.account_id}:root",
                    payload_json={
                        "account_id": acc.account_id,
                        "account_mfa_enabled": bool(summary_map.get("AccountMFAEnabled")),
                        "account_access_keys_present": int(summary_map.get("AccountAccessKeysPresent", 0)),
                        "summary_map": {k: int(v) for k, v in summary_map.items()},
                    },
                )
            )
        except Exception:  # noqa: BLE001
            log.warning("snapshot.account_summary_failed", account_id=str(acc.id))

    # IAM users
    for u in db.scalars(select(IamUser).where(IamUser.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="iam_user",
            entity_id=u.arn,
            payload_json={
                "username": u.name,
                "arn": u.arn,
                "has_console_password": u.has_console_password,
                "mfa_active": u.mfa_enabled,
                "attached_policies": u.attached_policies or [],
                "inline_policy_names": list((u.inline_policies or {}).keys()),
                "last_used_at": u.password_last_used.isoformat() if u.password_last_used else None,
                "created_at": u.created.isoformat() if u.created else None,
            },
        ))

    # IAM access keys
    for k in db.scalars(select(IamAccessKey).where(IamAccessKey.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="iam_access_key",
            entity_id=k.key_id,
            payload_json={
                "access_key_id": k.key_id,
                "user_arn": k.user_arn,
                "status": k.status,
                "created_at": k.created.isoformat() if k.created else None,
                "last_used_at": k.last_used.isoformat() if k.last_used else None,
            },
        ))

    # IAM roles
    for r in db.scalars(select(IamRole).where(IamRole.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="iam_role",
            entity_id=r.arn,
            payload_json={
                "role_name": r.name,
                "arn": r.arn,
                "last_used_at": r.last_assumed.isoformat() if r.last_assumed else None,
                "created_at": r.created.isoformat() if r.created else None,
                "trust_policy": r.trust_policy,
            },
        ))

    # S3 buckets
    for b in db.scalars(select(S3Bucket).where(S3Bucket.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="s3_bucket",
            entity_id=b.arn,
            payload_json={
                "name": b.name,
                "arn": b.arn,
                "logging_enabled": b.logging_enabled,
                "encrypted": b.encrypted,
                "kms_encrypted": b.kms_encrypted,
                "versioning_enabled": b.versioning_enabled,
                "public_access_blocked": b.public_access_blocked,
                "https_only": b.https_only,
            },
        ))

    for pab in db.scalars(select(S3AccountPublicAccessBlock).where(S3AccountPublicAccessBlock.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="s3_account_public_access_block",
            entity_id=str(acc.account_id or acc.id),
            payload_json={
                "block_public_acls": pab.block_public_acls,
                "ignore_public_acls": pab.ignore_public_acls,
                "block_public_policy": pab.block_public_policy,
                "restrict_public_buckets": pab.restrict_public_buckets,
                "all_blocked": pab.all_blocked,
            },
        ))

    # KMS keys
    for k in db.scalars(select(KmsKey).where(KmsKey.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="kms_key",
            entity_id=k.arn,
            payload_json={
                "key_id": k.key_id,
                "arn": k.arn,
                "alias": k.alias,
                "rotation_enabled": k.rotation_enabled,
                "key_state": k.key_state,
                "has_wildcard_principal": k.has_wildcard_principal,
            },
        ))

    for p in db.scalars(select(IamPasswordPolicy).where(IamPasswordPolicy.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="iam_password_policy",
            entity_id=str(acc.account_id or acc.id),
            payload_json={
                "exists": p.exists,
                "min_length": p.min_length,
                "require_uppercase": p.require_uppercase,
                "require_lowercase": p.require_lowercase,
                "require_numbers": p.require_numbers,
                "require_symbols": p.require_symbols,
                "max_age": p.max_age,
                "password_reuse_prevention": p.password_reuse_prevention,
            },
        ))

    for t in db.scalars(select(CloudTrailTrail).where(CloudTrailTrail.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="cloudtrail_trail",
            entity_id=t.arn,
            payload_json={
                "name": t.name,
                "arn": t.arn,
                "home_region": t.home_region,
                "is_multi_region": t.is_multi_region,
                "is_logging": t.is_logging,
                "log_validation_enabled": t.log_validation_enabled,
                "kms_key_id": t.kms_key_id,
            },
        ))

    for d in db.scalars(select(GuardDutyDetector).where(GuardDutyDetector.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="guardduty_detector",
            entity_id=f"{d.region}:{d.detector_id}",
            payload_json={"detector_id": d.detector_id, "region": d.region, "status": d.status},
        ))

    for a in db.scalars(select(AccessAnalyzer).where(AccessAnalyzer.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="access_analyzer",
            entity_id=f"{a.region}:{a.analyzer_name or 'none'}",
            payload_json={"region": a.region, "analyzer_name": a.analyzer_name, "status": a.status},
        ))

    for c in db.scalars(select(ConfigRecorder).where(ConfigRecorder.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="config_recorder",
            entity_id=f"{c.region}:{c.recorder_name or 'none'}",
            payload_json={
                "region": c.region,
                "recorder_name": c.recorder_name,
                "recording": c.recording,
                "delivery_channel_exists": c.delivery_channel_exists,
            },
        ))

    for s in db.scalars(select(SecurityHubStatus).where(SecurityHubStatus.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="security_hub",
            entity_id=f"{s.region}:{s.hub_arn or 'disabled'}",
            payload_json={"region": s.region, "hub_arn": s.hub_arn, "enabled": s.enabled},
        ))

    for v in db.scalars(select(Vpc).where(Vpc.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="vpc",
            entity_id=f"{v.region}:{v.vpc_id}",
            payload_json={"vpc_id": v.vpc_id, "region": v.region, "flow_logs_enabled": v.flow_logs_enabled},
        ))

    for sg in db.scalars(select(SecurityGroup).where(SecurityGroup.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="security_group",
            entity_id=f"{sg.region}:{sg.group_id}",
            payload_json={
                "group_id": sg.group_id,
                "group_name": sg.group_name,
                "region": sg.region,
                "vpc_id": sg.vpc_id,
                "is_default": sg.is_default,
                "unrestricted_ssh": sg.unrestricted_ssh,
                "unrestricted_rdp": sg.unrestricted_rdp,
                "has_any_inbound_rules": sg.has_any_inbound_rules,
                "has_any_outbound_rules": sg.has_any_outbound_rules,
            },
        ))

    for i in db.scalars(select(Ec2Instance).where(Ec2Instance.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="ec2_instance",
            entity_id=f"{i.region}:{i.instance_id}",
            payload_json={
                "instance_id": i.instance_id,
                "region": i.region,
                "instance_type": i.instance_type,
                "state": i.state,
                "imdsv2_required": i.imdsv2_required,
                "vpc_id": i.vpc_id,
                "subnet_id": i.subnet_id,
                "security_group_ids": i.security_group_ids,
                "tags": i.tags,
            },
        ))

    for v in db.scalars(select(EbsVolume).where(EbsVolume.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="ebs_volume",
            entity_id=v.arn,
            payload_json={
                "volume_id": v.volume_id,
                "arn": v.arn,
                "region": v.region,
                "encrypted": v.encrypted,
                "state": v.state,
                "size_gib": v.size_gib,
                "volume_type": v.volume_type,
                "attached_instance_ids": v.attached_instance_ids,
            },
        ))

    for e in db.scalars(select(EbsEncryptionDefault).where(EbsEncryptionDefault.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="ebs_encryption_default",
            entity_id=e.region,
            payload_json={"region": e.region, "enabled": e.enabled},
        ))

    for r in db.scalars(select(RdsInstance).where(RdsInstance.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="rds_instance",
            entity_id=r.arn,
            payload_json={
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
        ))

    for snap in db.scalars(select(RdsSnapshot).where(RdsSnapshot.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="rds_snapshot",
            entity_id=snap.arn,
            payload_json={
                "snapshot_id": snap.snapshot_id,
                "arn": snap.arn,
                "region": snap.region,
                "engine": snap.engine,
                "encrypted": snap.encrypted,
                "is_public": snap.is_public,
            },
        ))

    for snap in db.scalars(select(EbsSnapshot).where(EbsSnapshot.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="ebs_snapshot",
            entity_id=snap.arn,
            payload_json={
                "snapshot_id": snap.snapshot_id,
                "arn": snap.arn,
                "region": snap.region,
                "encrypted": snap.encrypted,
                "is_public": snap.is_public,
            },
        ))

    for ami in db.scalars(select(Ec2Ami).where(Ec2Ami.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="ec2_ami",
            entity_id=ami.arn,
            payload_json={
                "image_id": ami.image_id,
                "arn": ami.arn,
                "region": ami.region,
                "name": ami.name,
                "is_public": ami.is_public,
                "created_at": ami.created_at.isoformat() if ami.created_at else None,
            },
        ))

    for cluster in db.scalars(select(EksCluster).where(EksCluster.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="eks_cluster",
            entity_id=cluster.arn,
            payload_json={
                "name": cluster.name,
                "arn": cluster.arn,
                "region": cluster.region,
                "endpoint_public_access": cluster.endpoint_public_access,
                "endpoint_private_access": cluster.endpoint_private_access,
                "public_access_cidrs": cluster.public_access_cidrs or [],
                "version": cluster.version,
                "status": cluster.status,
            },
        ))

    for gf in db.scalars(select(GuardDutyFinding).where(GuardDutyFinding.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="guardduty_finding",
            entity_id=f"{gf.region}:{gf.finding_id}",
            payload_json={
                "region": gf.region,
                "finding_id": gf.finding_id,
                "severity": gf.severity,
                "title": gf.title,
                "finding_type": gf.finding_type,
                "archived": gf.archived,
            },
        ))

    for ic in db.scalars(select(IdentityCenterUser).where(IdentityCenterUser.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="identity_center_user",
            entity_id=f"{ic.identity_store_id}:{ic.user_id}",
            payload_json={
                "user_id": ic.user_id,
                "user_name": ic.user_name,
                "display_name": ic.display_name,
                "email": ic.email,
                "active": ic.active,
            },
        ))

    try:
        for ps in list_permission_set_snapshots(acc):
            arn = ps.get("permission_set_arn")
            if not arn:
                continue
            snaps.append(
                EvidenceSnapshot(
                    id=uuid.uuid4(),
                    scan_run_id=run.id,
                    account_id=acc.id,
                    org_id=acc.org_id,
                    entity_type="identity_center_permission_set",
                    entity_id=arn,
                    payload_json=ps,
                )
            )
    except Exception:  # noqa: BLE001
        log.warning("snapshot.identity_center_permission_sets_failed", account_id=str(acc.id))

    for rule in db.scalars(select(ConfigRuleCompliance).where(ConfigRuleCompliance.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="config_rule_compliance",
            entity_id=f"{rule.region}:{rule.rule_name}",
            payload_json={
                "region": rule.region,
                "rule_name": rule.rule_name,
                "compliance_type": rule.compliance_type,
            },
        ))

    for cert in db.scalars(select(AcmCertificate).where(AcmCertificate.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="acm_certificate",
            entity_id=cert.certificate_arn,
            payload_json={
                "certificate_arn": cert.certificate_arn,
                "region": cert.region,
                "domain_name": cert.domain_name,
                "expires_at": cert.expires_at.isoformat() if cert.expires_at else None,
                "status": cert.status,
            },
        ))

    for fn in db.scalars(select(LambdaFunction).where(LambdaFunction.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="lambda_function",
            entity_id=fn.arn,
            payload_json={
                "function_name": fn.function_name,
                "arn": fn.arn,
                "region": fn.region,
                "runtime": fn.runtime,
                "has_dlq": fn.has_dlq,
                "function_url": fn.function_url,
                "function_url_auth_type": fn.function_url_auth_type,
            },
        ))

    for repo in db.scalars(select(EcrRepository).where(EcrRepository.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="ecr_repository",
            entity_id=repo.repository_arn,
            payload_json={
                "repository_name": repo.repository_name,
                "repository_arn": repo.repository_arn,
                "region": repo.region,
                "scan_on_push": repo.scan_on_push,
                "encryption_type": repo.encryption_type,
            },
        ))

    for cluster in db.scalars(select(EcsCluster).where(EcsCluster.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="ecs_cluster",
            entity_id=cluster.arn,
            payload_json={
                "cluster_name": cluster.name,
                "region": cluster.region,
                "container_insights_enabled": cluster.container_insights_enabled,
                "status": cluster.status,
            },
        ))

    for service in db.scalars(select(EcsService).where(EcsService.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="ecs_service",
            entity_id=service.service_arn,
            payload_json={
                "service_name": service.service_name,
                "cluster_name": service.cluster_name,
                "region": service.region,
                "assign_public_ip": service.assign_public_ip,
                "launch_type": service.launch_type,
                "status": service.status,
                "task_definition_arn": service.task_definition_arn,
            },
        ))

    for secret in db.scalars(select(SecretsManagerSecret).where(SecretsManagerSecret.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="secrets_manager_secret",
            entity_id=secret.secret_arn,
            payload_json={
                "name": secret.name,
                "secret_arn": secret.secret_arn,
                "region": secret.region,
                "rotation_enabled": secret.rotation_enabled,
            },
        ))

    for param in db.scalars(select(SsmParameter).where(SsmParameter.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="ssm_parameter",
            entity_id=f"{param.region}:{param.parameter_name}",
            payload_json={
                "parameter_name": param.parameter_name,
                "region": param.region,
                "parameter_type": param.parameter_type,
            },
        ))

    for lb in db.scalars(select(ElbLoadBalancer).where(ElbLoadBalancer.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="elb_load_balancer",
            entity_id=lb.load_balancer_arn,
            payload_json={
                "name": lb.name,
                "load_balancer_arn": lb.load_balancer_arn,
                "region": lb.region,
                "lb_type": lb.lb_type,
                "access_logs_enabled": lb.access_logs_enabled,
                "ssl_policy": lb.ssl_policy,
            },
        ))

    for table in db.scalars(select(DynamoDbTable).where(DynamoDbTable.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="dynamodb_table",
            entity_id=table.arn,
            payload_json={
                "table_name": table.table_name,
                "arn": table.arn,
                "region": table.region,
                "pitr_enabled": table.pitr_enabled,
                "kms_encrypted": table.kms_encrypted,
            },
        ))

    for topic in db.scalars(select(SnsTopic).where(SnsTopic.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="sns_topic",
            entity_id=topic.topic_arn,
            payload_json={
                "topic_arn": topic.topic_arn,
                "region": topic.region,
                "kms_encrypted": topic.kms_encrypted,
            },
        ))

    for queue in db.scalars(select(SqsQueue).where(SqsQueue.account_id == acc.id)).all():
        snaps.append(EvidenceSnapshot(
            id=uuid.uuid4(),
            scan_run_id=run.id,
            account_id=acc.id,
            org_id=acc.org_id,
            entity_type="sqs_queue",
            entity_id=queue.queue_arn,
            payload_json={
                "queue_arn": queue.queue_arn,
                "queue_url": queue.queue_url,
                "region": queue.region,
                "kms_encrypted": queue.kms_encrypted,
            },
        ))

    from app.services.snapshot_provenance import attach_provenance

    for snap in snaps:
        snap.payload_json = attach_provenance(snap.payload_json, snap.entity_type, run.id)

    db.add_all(snaps)
    return len(snaps)


@celery_app.task(
    name="app.worker.tasks.run_scan",
    soft_time_limit=900,  # 15 min — worker gets a SoftTimeLimitExceeded signal
    time_limit=1200,      # 20 min — hard kill if still running after this
)
def run_scan(account_id: str) -> dict:
    """Run a full scan for the given AwsAccount.

    Step-by-step error capture: each collector and check phase is tagged
    with a `step` name. If anything raises, the failing step + truncated
    traceback are stored in `scan_runs.error` + `scan_runs.stats.failed_at`.
    Per-check failures don't fail the whole scan — they're recorded in
    `stats.check_errors` and the remaining checks still run.
    """
    db = SessionLocal()
    step = "bootstrap"
    run: ScanRun | None = None
    acc: AwsAccount | None = None
    try:
        try:
            acc_uuid = uuid.UUID(account_id)
        except ValueError:
            log.warning("scan.bad_account_id", account_id=account_id)
            db.close()
            return {"ok": False, "error": "invalid account id"}

        acc = db.get(AwsAccount, acc_uuid)
        if not acc:
            log.warning("scan.account_not_found", account_id=account_id)
            db.close()
            return {"ok": False, "error": "account not found"}

        run = ScanRun(id=uuid.uuid4(), account_id=acc.id, status="running")
        db.add(run)
        db.commit()
    except Exception:
        # Bootstrap (DB connect, ScanRun insert) blew up — log and propagate.
        # No scan_run row exists yet so Celery just marks the task failed.
        log.exception("scan.bootstrap_failed", account_id=account_id, step=step)
        db.close()
        raise

    try:
        from app.core.aws import ensure_vigil_role_trust
        from app.core.config import get_settings as _scan_settings

        if _scan_settings().APP_ENV == "dev" and acc.role_arn and acc.external_id:
            ensure_vigil_role_trust(acc.role_arn, acc.external_id)

        stats: dict = {}

        from app.services.check_settings import is_check_enabled

        org_obj = db.get(Org, acc.org_id)
        org_settings = org_obj.settings if org_obj else {}
        enabled_checks = [mod for mod in ALL_CHECKS if is_check_enabled(org_settings, mod.CHECK_ID)]

        # Collectors are fast; checks + finalize dominate wall time — weight progress accordingly.
        # Keep in sync with the collector _step(...) calls below + WORKER_COLLECTOR_STEPS (web).
        _COLLECTOR_STEPS = 31
        _FINALIZE_STEPS = 2
        _TOTAL_STEPS = _COLLECTOR_STEPS + len(enabled_checks) + _FINALIZE_STEPS
        _step_counter = 0
        _PROGRESS_COMMIT_EVERY = 4

        def _phase_for(s: int) -> int:
            """Map the step counter to a real UI phase by section, not a flat ratio.
            0 Initializing · 1 Collecting · 2 Analyzing · 3 Policy eval · 4 Risk · 5 Reporting."""
            if s <= 0:
                return 0
            if s <= _COLLECTOR_STEPS:
                return 1 if s <= int(_COLLECTOR_STEPS * 0.6) else 2
            cs = s - _COLLECTOR_STEPS
            nchecks = len(enabled_checks)
            if cs <= nchecks:
                return 3 if cs <= int(nchecks * 0.8) else 4
            return 5

        def _publish_progress() -> None:
            run.stats = {
                **stats,
                "_progress_step": _step_counter,
                "_progress_total": _TOTAL_STEPS,
                "_progress_phase": _phase_for(_step_counter),
            }
            db.commit()

        def _step(name: str, fn):
            nonlocal step, _step_counter
            step = name
            result = fn()
            _step_counter += 1
            _publish_progress()
            return result

        stats.update(_step("collect_iam", lambda: collect_iam(db, acc)))
        stats.update(_step("collect_account_governance", lambda: collect_account_governance(db, acc)))
        stats["iam_server_certificates"] = _step(
            "collect_iam_server_certificates", lambda: collect_iam_server_certificates(db, acc)
        )
        stats["s3_account_public_access_block"] = _step(
            "collect_s3_public_access_block",
            lambda: collect_s3_account_public_access_block(db, acc),
        )
        stats["s3_buckets"] = _step("collect_s3", lambda: collect_s3(db, acc))
        stats["kms_keys"] = _step("collect_kms", lambda: collect_kms(db, acc))
        stats["cloudtrail_trails"] = _step("collect_cloudtrail", lambda: collect_cloudtrail(db, acc))
        stats["cloudtrail_events"] = _step("collect_cloudtrail_events", lambda: collect_cloudtrail_events(db, acc))
        vpc_stats = _step("collect_vpc", lambda: collect_vpc(db, acc))
        stats["vpcs"] = vpc_stats.get("vpcs", 0)
        stats["security_groups"] = vpc_stats.get("security_groups", 0)
        stats["guardduty_detectors"] = _step("collect_guardduty", lambda: collect_guardduty(db, acc))
        stats["guardduty_findings"] = _step("collect_guardduty_findings", lambda: collect_guardduty_findings(db, acc))
        stats["identity_center_users"] = _step("collect_identity_center", lambda: collect_identity_center(db, acc))
        stats["rds_instances"] = _step("collect_rds", lambda: collect_rds(db, acc))
        ec2_stats = _step("collect_ec2", lambda: collect_ec2(db, acc))
        stats["ec2_instances"] = ec2_stats.get("instances", 0)
        stats["ebs_volumes"] = ec2_stats.get("volumes", 0)
        stats["ebs_snapshots"] = ec2_stats.get("snapshots", 0)
        stats["ec2_amis"] = ec2_stats.get("amis", 0)
        stats["ebs_regions"] = ec2_stats.get("ebs_regions", 0)
        stats["acm_certificates"] = _step("collect_acm", lambda: collect_acm(db, acc))
        stats["lambda_functions"] = _step("collect_lambda", lambda: collect_lambda(db, acc))
        stats["secrets_manager_secrets"] = _step("collect_secrets", lambda: collect_secrets(db, acc))
        stats["ssm_parameters"] = _step("collect_ssm_parameters", lambda: collect_ssm_parameters(db, acc))
        stats["elb_load_balancers"] = _step("collect_elb", lambda: collect_elb(db, acc))
        stats["dynamodb_tables"] = _step("collect_dynamodb", lambda: collect_dynamodb(db, acc))
        stats["ecr_repositories"] = _step("collect_ecr", lambda: collect_ecr(db, acc))
        stats["ecr_registry_settings"] = _step("collect_ecr_registry_settings", lambda: collect_ecr_registry_settings(db, acc))
        stats["eks_clusters"] = _step("collect_eks", lambda: collect_eks(db, acc))
        ecs_stats = _step("collect_ecs", lambda: collect_ecs(db, acc))
        stats["ecs_clusters"] = ecs_stats.get("clusters", 0)
        stats["ecs_services"] = ecs_stats.get("services", 0)
        stats["ecs_task_definitions"] = ecs_stats.get("task_definitions", 0)
        inspector_stats = _step("collect_inspector", lambda: collect_inspector(db, acc))
        stats["inspector_regions"] = inspector_stats.get("regions", 0)
        stats["inspector_findings"] = inspector_stats.get("findings", 0)
        stats["sns_topics"] = _step("collect_sns", lambda: collect_sns(db, acc))
        stats["sqs_queues"] = _step("collect_sqs", lambda: collect_sqs(db, acc))
        stats["access_analyzers"] = _step("collect_access_analyzer", lambda: collect_access_analyzer(db, acc))
        stats["config_regions"] = _step("collect_config_service", lambda: collect_config_service(db, acc))
        stats["config_rule_compliance"] = _step("collect_config_compliance", lambda: collect_config_compliance(db, acc))
        stats["securityhub_regions"] = _step("collect_securityhub", lambda: collect_securityhub(db, acc))

        step = "run_checks"
        drafts = []
        check_ids_run: set[str] = set()
        check_errors: list[dict] = []

        for idx, mod in enumerate(enabled_checks):
            step = f"check:{mod.CHECK_ID}"
            check_ids_run.add(mod.CHECK_ID)
            try:
                drafts.extend(mod.run(db, acc.id))
            except Exception as inner:  # noqa: BLE001
                # One bad check shouldn't kill the whole scan. Record and continue.
                log.exception(
                    "scan.check_failed",
                    check_id=mod.CHECK_ID,
                    account_id=str(acc.id),
                )
                check_errors.append({
                    "check_id": mod.CHECK_ID,
                    "error_type": type(inner).__name__,
                    "error": str(inner)[:300],
                })
            _step_counter += 1
            if (idx + 1) % _PROGRESS_COMMIT_EVERY == 0 or idx == len(enabled_checks) - 1:
                _publish_progress()

        def _persist() -> dict:
            o, r = persist_findings(
                db,
                org_id=acc.org_id,
                account_id=acc.id,
                drafts=drafts,
                check_ids_run=check_ids_run,
            )
            return {"opened": o, "resolved": r}

        persist_stats = _step("persist_findings", _persist)
        opened = persist_stats["opened"]
        resolved = persist_stats["resolved"]

        snap_count = _step("write_evidence_snapshots", lambda: _write_evidence_snapshots(db, acc, run))

        run.status = "degraded" if check_errors else "ok"
        run.finished_at = datetime.now(timezone.utc)
        final_stats = stats | {
            "checks_run": list(check_ids_run),
            "drafts": len(drafts),
            "snapshots": snap_count,
            "checks_total": len(ALL_CHECKS),
        }
        if check_errors:
            final_stats["check_errors"] = check_errors
            final_stats["checks_failed"] = len(check_errors)
        run.stats = final_stats
        run.findings_opened = opened
        run.findings_resolved = resolved
        acc.last_scan_at = run.finished_at
        db.commit()
        log.info(
            "scan.complete",
            account_id=str(acc.id),
            opened=opened,
            resolved=resolved,
            snapshots=snap_count,
            check_errors=len(check_errors),
        )

        _enqueue_post_scan_tasks(account_id)

        try:
            from app.services.scan_alert import notify_new_findings

            notify_new_findings(db, acc.id, run.id)
        except Exception:  # noqa: BLE001
            log.exception("scan.new_findings_notify_failed", account_id=str(acc.id))

        return {"ok": True, "opened": opened, "resolved": resolved, "snapshots": snap_count}
    except Exception as e:  # noqa: BLE001
        db.rollback()
        tb = traceback.format_exc()
        # Re-fetch the run row (rollback may have detached it from the session)
        try:
            run = db.get(ScanRun, run.id) if run is not None else None
        except Exception:  # noqa: BLE001
            run = None
        error_persisted = False
        if run is not None:
            run.status = "error"
            run.finished_at = datetime.now(timezone.utc)
            run.error = (f"{type(e).__name__} during {step}: {e}\n\n{tb}")[:1990]
            existing = run.stats or {}
            run.stats = existing | {
                "failed_at": step,
                "error_type": type(e).__name__,
            }
            try:
                db.commit()
                error_persisted = True
            except Exception:  # noqa: BLE001
                db.rollback()
                log.exception("scan.error_persist_failed", account_id=str(acc.id) if acc else None)
        log.exception(
            "scan.failed",
            account_id=str(acc.id) if acc else None,
            step=step,
            error_type=type(e).__name__,
        )
        if error_persisted and run is not None and acc is not None:
            try:
                from app.services.scan_alert import notify_scan_failure

                notify_scan_failure(db, acc.id, run.id)
            except Exception:  # noqa: BLE001
                log.exception("scan.failure_notify_failed", account_id=str(acc.id))
        return {"ok": False, "error": str(e), "step": step}
    finally:
        db.close()


@celery_app.task(name="app.worker.tasks.collect_perm_usage_task")
def collect_perm_usage_task(account_id: str) -> dict:
    """Background task: collect service last-accessed per role, then re-run unused_services check."""
    db = SessionLocal()
    try:
        acc = db.get(AwsAccount, uuid.UUID(account_id))
        if not acc:
            return {"error": "account not found"}

        count = collect_perm_usage(db, acc)

        drafts = role_unused_services.run(db, acc.id)
        if drafts:
            persist_findings(
                db,
                org_id=acc.org_id,
                account_id=acc.id,
                drafts=drafts,
                check_ids_run={role_unused_services.CHECK_ID},
            )

        log.info("perm_usage.complete", account_id=account_id, upserted=count, findings=len(drafts))
        return {"ok": True, "upserted": count, "findings": len(drafts)}
    except Exception as e:  # noqa: BLE001
        db.rollback()
        log.exception("perm_usage.failed", account_id=account_id)
        return {"ok": False, "error": str(e)}
    finally:
        db.close()


@celery_app.task(name="app.worker.tasks.recheck_finding")
def recheck_finding(account_id: str, check_id: str) -> dict:
    """Re-collect only what's needed for check_id, then rerun that check."""
    db = SessionLocal()
    try:
        acc = db.get(AwsAccount, uuid.UUID(account_id))
        if not acc:
            return {"error": "account not found"}

        collector = next(
            (fn for prefix, fn in _COLLECTOR_FOR_CHECK.items() if check_id.startswith(prefix)),
            None,
        )
        if collector:
            collector(db, acc)

        mod = _CHECK_BY_ID.get(check_id)
        if not mod:
            return {"error": f"unknown check: {check_id}"}

        drafts = mod.run(db, acc.id)
        opened, resolved = persist_findings(
            db,
            org_id=acc.org_id,
            account_id=acc.id,
            drafts=drafts,
            check_ids_run={check_id},
        )
        log.info("recheck.complete", account_id=account_id, check_id=check_id, opened=opened, resolved=resolved)
        return {"ok": True, "opened": opened, "resolved": resolved}
    except Exception as e:  # noqa: BLE001
        db.rollback()
        log.exception("recheck.failed", account_id=account_id, check_id=check_id)
        return {"ok": False, "error": str(e)}
    finally:
        db.close()


@celery_app.task(name="app.worker.tasks.scan_all_accounts")
def scan_all_accounts() -> dict:
    """Queue scans for connected accounts whose org schedule says they're due."""
    from app.services.scan_schedule import get_scanning_settings, should_queue_automated_scan

    db = SessionLocal()
    queued = 0
    skipped = 0
    try:
        accounts = db.scalars(select(AwsAccount).where(AwsAccount.status == "connected")).all()
        now = datetime.now(timezone.utc)
        for acc in accounts:
            org = db.get(Org, acc.org_id)
            if not org:
                skipped += 1
                continue
            scanning = get_scanning_settings(org.settings or {})
            if not should_queue_automated_scan(acc, scanning, db, now):
                skipped += 1
                continue
            run_scan.delay(str(acc.id))
            queued += 1
        return {"queued": queued, "skipped": skipped}
    finally:
        db.close()


@celery_app.task(name="app.worker.tasks.reap_stuck_scan_runs")
def reap_stuck_scan_runs(max_age_minutes: int = 30) -> dict:
    """Mark ScanRuns stuck in 'running' as failed.

    Called on worker startup with max_age_minutes=0 (any in-flight scan from a
    prior process is dead) and periodically with the default to catch scans
    that hang silently (network stall, OOM, etc.)."""
    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=max_age_minutes)
        stale = db.scalars(
            select(ScanRun)
            .where(ScanRun.status == "running")
            .where(ScanRun.started_at < cutoff)
        ).all()
        now = datetime.now(timezone.utc)
        for run in stale:
            run.status = "error"
            run.finished_at = now
            run.error = "scan interrupted (worker restart or timeout)"
        if stale:
            db.commit()
            log.info("reap_stuck_scan_runs", count=len(stale), max_age_minutes=max_age_minutes)
        return {"reaped": len(stale)}
    finally:
        db.close()


@celery_app.task(name="app.worker.tasks.prune_assume_role_audit")
def prune_assume_role_audit(retention_days: int = 365) -> dict:
    """Delete assume_role_audit rows older than `retention_days` (default 1 year).

    Customer-facing audit log doesn't need to live forever — most disputes
    are resolved within weeks. 1y retention keeps the table small and is
    long enough for any reasonable SOC2 evidence window.
    """
    from sqlalchemy import delete as sql_delete

    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        result = db.execute(
            sql_delete(AssumeRoleAudit).where(AssumeRoleAudit.called_at < cutoff)
        )
        deleted = result.rowcount or 0
        db.commit()
        if deleted:
            log.info("prune_assume_role_audit", deleted=deleted, retention_days=retention_days)
        return {"deleted": deleted, "retention_days": retention_days}
    except Exception:  # noqa: BLE001
        db.rollback()
        log.exception("prune_assume_role_audit.failed")
        return {"ok": False, "deleted": 0}
    finally:
        db.close()


@celery_app.task(name="app.worker.tasks.send_weekly_digests")
def send_weekly_digests() -> dict:
    """Send Monday digest to all org members with a connected account."""
    from app.services.digest import send_digest

    db = SessionLocal()
    sent = 0
    skipped = 0
    try:
        orgs = db.scalars(select(Org)).all()
        since = datetime.now(timezone.utc) - timedelta(days=7)

        for org in orgs:
            org_settings = org.settings or {}
            if not org_settings.get("notifications", {}).get("email_digest_enabled", False):
                skipped += 1
                continue

            acc = db.scalars(
                select(AwsAccount).where(
                    AwsAccount.org_id == org.id,
                    AwsAccount.status == "connected",
                )
            ).first()
            if not acc:
                skipped += 1
                continue

            from app.services.check_settings import hidden_check_ids

            org_settings = org.settings or {}
            hidden = hidden_check_ids(org_settings)

            open_q = select(Finding).where(
                Finding.account_id == acc.id,
                Finding.status == "open",
            )
            if hidden:
                open_q = open_q.where(Finding.check_id.notin_(hidden))
            open_findings = db.scalars(open_q.order_by(Finding.risk_score.desc())).all()

            new_q = select(Finding).where(
                Finding.account_id == acc.id,
                Finding.first_seen >= since,
            )
            if hidden:
                new_q = new_q.where(Finding.check_id.notin_(hidden))
            new_this_week = db.scalars(new_q).all()

            from sqlalchemy import func as sa_func
            resolved_count = db.scalar(
                select(sa_func.count()).select_from(
                    select(Finding).where(
                        Finding.account_id == acc.id,
                        Finding.status == "resolved",
                        Finding.last_seen >= since,
                    ).subquery()
                )
            ) or 0

            findings_dicts = [
                {
                    "title": f.title,
                    "severity": f.severity,
                    "risk_score": f.risk_score,
                    "resource_arn": f.resource_arn,
                    "check_id": f.check_id,
                }
                for f in open_findings
            ]
            new_dicts = [
                {"title": f.title, "severity": f.severity}
                for f in new_this_week
            ]

            from app.services.digest_tokens import persist_digest_unsubscribe_token

            unsubscribe_token = persist_digest_unsubscribe_token(db, org)

            digest_email = org_settings.get("notifications", {}).get("digest_email")
            if digest_email:
                recipients = [digest_email]
            else:
                recipients = [
                    u.email
                    for u in db.scalars(select(User).where(User.org_id == org.id)).all()
                    if u.email
                ]

            for email in recipients:
                ok = send_digest(
                    to=email,
                    org_name=org.name if hasattr(org, "name") else str(org.id),
                    account_label=acc.label,
                    open_findings=findings_dicts,
                    new_this_week=new_dicts,
                    resolved_this_week=resolved_count,
                    unsubscribe_token=unsubscribe_token,
                )
                if ok:
                    sent += 1

            slack_url = org_settings.get("notifications", {}).get("slack_webhook_url")
            if slack_url:
                try:
                    import httpx as _httpx
                    critical_count = sum(1 for f in open_findings if f.severity in ("critical", "high"))
                    _httpx.post(slack_url, json={
                        "text": (
                            f":shield: *Vigil weekly digest — {acc.label}*\n"
                            f"Open findings: {len(open_findings)} ({critical_count} critical/high) · "
                            f"New this week: {len(new_this_week)} · Resolved: {resolved_count}"
                        )
                    }, timeout=10)
                except Exception:  # noqa: BLE001
                    pass

        log.info("digests.complete", sent=sent, skipped=skipped)
        return {"sent": sent, "skipped": skipped}
    except Exception as e:  # noqa: BLE001
        log.exception("digests.failed")
        return {"ok": False, "error": str(e)}
    finally:
        db.close()


@celery_app.task(
    name="app.worker.tasks.ai_triage_task",
    soft_time_limit=120,  # 2 min — LLM calls should be fast
    time_limit=180,       # 3 min hard kill
)
def ai_triage_task(account_id: str) -> dict:
    """Run AI triage on new/updated findings for an account after a scan.

    Gathers context for each finding (finding details + evidence snapshots +
    account info + recent history of the same check), sends it to the LLM,
    and stores the result in ai_triage_results.

    Runs fire-and-forget — failures are logged but never block the scan.
    """
    from app.core.config import get_settings as _settings

    from app.services.ai_finding_review import llm_triage_available

    settings = _settings()
    use_llm = llm_triage_available()

    db = SessionLocal()
    triaged = 0
    try:
        acc_uuid = uuid.UUID(account_id)
        acc = db.get(AwsAccount, acc_uuid)
        if not acc:
            return {"ok": False, "error": "account not found"}

        from app.models.org import Org
        from app.services.ai_finding_review import org_ai_finding_review_enabled

        org = db.get(Org, acc.org_id)
        if not org_ai_finding_review_enabled(org):
            return {"ok": True, "triaged": 0, "reason": "org_disabled"}

        # Gather findings that are open (haven't been resolved/ignored yet)
        from sqlalchemy import select as sa_select

        open_findings = db.scalars(
            sa_select(Finding).where(
                Finding.account_id == acc_uuid,
                Finding.status.in_(("open", "snoozed")),
            )
        ).all()

        if not open_findings:
            return {"ok": True, "triaged": 0}

        from app.models.ai_triage import AITriageResult
        from app.services.ai_finding_review import apply_heuristic_triage
        from app.services.ai_triage import call_llm_for_triage

        model_ver = settings.AI_TRIAGE_MODEL

        for finding in open_findings:
            # Check if already triaged recently (within last 24h)
            from datetime import timedelta
            existing = db.scalars(
                sa_select(AITriageResult)
                .where(
                    AITriageResult.finding_id == finding.id,
                    AITriageResult.created_at >= func.now() - timedelta(hours=24),
                )
                .order_by(AITriageResult.created_at.desc())
                .limit(1)
            ).first()
            if existing:
                continue  # already triaged recently

            # Build context for the LLM
            evidence_snaps = db.scalars(
                sa_select(EvidenceSnapshot).where(
                    EvidenceSnapshot.account_id == acc_uuid,
                ).order_by(EvidenceSnapshot.ts.desc()).limit(20)
            ).all()

            # Recent history of same check
            history_count = db.scalar(
                sa_select(func.count()).select_from(
                    sa_select(Finding).where(
                        Finding.account_id == acc_uuid,
                        Finding.check_id == finding.check_id,
                    ).subquery()
                )
            ) or 0

            # Resolved count for the same check
            resolved_same_check = db.scalar(
                sa_select(func.count()).select_from(
                    sa_select(Finding).where(
                        Finding.account_id == acc_uuid,
                        Finding.check_id == finding.check_id,
                        Finding.status == "resolved",
                    ).subquery()
                )
            ) or 0

            finding_context = {
                "finding": {
                    "check_id": finding.check_id,
                    "title": finding.title,
                    "severity": finding.severity,
                    "risk_score": finding.risk_score,
                    "status": finding.status,
                    "resource_arn": finding.resource_arn,
                    "evidence": finding.evidence,
                    "first_seen": finding.first_seen.isoformat() if finding.first_seen else None,
                    "last_seen": finding.last_seen.isoformat() if finding.last_seen else None,
                },
                "account": {
                    "account_id": acc.account_id,
                    "label": acc.label,
                    "status": acc.status,
                    "last_scan_at": acc.last_scan_at.isoformat() if acc.last_scan_at else None,
                },
                "evidence_snapshots": [
                    {
                        "entity_type": s.entity_type,
                        "entity_id": s.entity_id,
                        "payload": s.payload_json,
                    }
                    for s in evidence_snaps
                ],
                "history": {
                    "total_findings_for_check": history_count,
                    "resolved_same_check": resolved_same_check,
                },
            }

            if use_llm:
                result = call_llm_for_triage(finding_context)
                if result is None:
                    apply_heuristic_triage(db, finding)
                    triaged += 1
                    continue
                triage_result = AITriageResult(
                    id=uuid.uuid4(),
                    finding_id=finding.id,
                    confidence_score=result.confidence_score,
                    rationale=result.rationale,
                    suggested_action=result.suggested_action,
                    findings_context=finding_context,
                    model_version=model_ver,
                )
                db.add(triage_result)
            else:
                apply_heuristic_triage(db, finding)
            triaged += 1

        db.commit()
        log.info("ai_triage.task_complete", account_id=account_id, triaged=triaged)
        return {"ok": True, "triaged": triaged}
    except Exception as e:  # noqa: BLE001
        db.rollback()
        log.exception("ai_triage.task_failed", account_id=account_id)
        return {"ok": False, "error": str(e), "triaged": triaged}
    finally:
        db.close()


@celery_app.task(
    name="app.worker.tasks.ai_triage_single_finding",
    soft_time_limit=60,
    time_limit=90,
)
def ai_triage_single_finding(finding_id: str) -> dict:
    """Run AI triage on a single finding (triggered by manual re-triage endpoint)."""
    from app.core.config import get_settings as _settings

    from app.services.ai_finding_review import apply_heuristic_triage, llm_triage_available, org_ai_finding_review_enabled

    settings = _settings()
    use_llm = llm_triage_available()

    db = SessionLocal()
    try:
        fid = uuid.UUID(finding_id)
        finding = db.get(Finding, fid)
        if not finding:
            return {"ok": False, "error": "finding not found"}

        from app.models.org import Org
        from app.models.ai_triage import AITriageResult
        from app.services.ai_triage import call_llm_for_triage

        org = db.get(Org, finding.org_id)
        if not org_ai_finding_review_enabled(org):
            return {"ok": True, "reason": "org_disabled"}

        if not use_llm:
            row = apply_heuristic_triage(db, finding)
            return {
                "ok": True,
                "review_mode": "local",
                "confidence_score": row.confidence_score,
                "rationale": row.rationale,
                "suggested_action": row.suggested_action,
            }

        evidence_snaps = db.scalars(
            select(EvidenceSnapshot).where(
                EvidenceSnapshot.account_id == finding.account_id,
            ).order_by(EvidenceSnapshot.ts.desc()).limit(20)
        ).all()

        history_count = db.scalar(
            select(func.count()).select_from(
                select(Finding).where(
                    Finding.account_id == finding.account_id,
                    Finding.check_id == finding.check_id,
                ).subquery()
            )
        ) or 0

        acc = db.get(AwsAccount, finding.account_id)

        finding_context = {
            "finding": {
                "check_id": finding.check_id,
                "title": finding.title,
                "severity": finding.severity,
                "risk_score": finding.risk_score,
                "status": finding.status,
                "resource_arn": finding.resource_arn,
                "evidence": finding.evidence,
                "first_seen": finding.first_seen.isoformat() if finding.first_seen else None,
                "last_seen": finding.last_seen.isoformat() if finding.last_seen else None,
            },
            "account": {
                "account_id": acc.account_id if acc else None,
                "label": acc.label if acc else None,
                "status": acc.status if acc else None,
            },
            "evidence_snapshots": [
                {"entity_type": s.entity_type, "entity_id": s.entity_id, "payload": s.payload_json}
                for s in evidence_snaps
            ],
            "history": {"total_findings_for_check": history_count},
        }

        result = call_llm_for_triage(finding_context)
        if result is None:
            row = apply_heuristic_triage(db, finding)
            return {
                "ok": True,
                "review_mode": "local",
                "confidence_score": row.confidence_score,
                "rationale": row.rationale,
                "suggested_action": row.suggested_action,
            }

        triage_result = AITriageResult(
            id=uuid.uuid4(),
            finding_id=finding.id,
            confidence_score=result.confidence_score,
            rationale=result.rationale,
            suggested_action=result.suggested_action,
            findings_context=finding_context,
            model_version=settings.AI_TRIAGE_MODEL,
        )
        db.add(triage_result)
        db.commit()

        log.info("ai_triage.single_complete", finding_id=finding_id)
        return {
            "ok": True,
            "confidence_score": result.confidence_score,
            "rationale": result.rationale,
            "suggested_action": result.suggested_action,
        }
    except Exception as e:  # noqa: BLE001
        db.rollback()
        log.exception("ai_triage.single_failed", finding_id=finding_id)
        return {"ok": False, "error": str(e)}
    finally:
        db.close()


@celery_app.task(name="app.worker.tasks.alert_stale_scans")
def alert_stale_scans() -> dict:
    """Hourly evidence-gap guard: alert when a connected account has not
    scanned within its configured interval (+ grace). See scan_alert."""
    from app.services.scan_alert import notify_stale_scans

    db = SessionLocal()
    try:
        sent = notify_stale_scans(db)
        return {"alerts_sent": sent}
    finally:
        db.close()
