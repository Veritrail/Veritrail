import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class S3Bucket(Base):
    __tablename__ = "s3_buckets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    arn: Mapped[str] = mapped_column(String(512))
    logging_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    encrypted: Mapped[bool] = mapped_column(Boolean, default=False)
    kms_encrypted: Mapped[bool] = mapped_column(Boolean, default=False)
    versioning_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    public_access_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    https_only: Mapped[bool] = mapped_column(Boolean, default=False)
    mfa_delete_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        __import__("sqlalchemy").UniqueConstraint("account_id", "arn"),
    )


class S3AccountPublicAccessBlock(Base):
    __tablename__ = "s3_account_public_access_blocks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), unique=True, index=True)
    block_public_acls: Mapped[bool] = mapped_column(Boolean, default=False)
    ignore_public_acls: Mapped[bool] = mapped_column(Boolean, default=False)
    block_public_policy: Mapped[bool] = mapped_column(Boolean, default=False)
    restrict_public_buckets: Mapped[bool] = mapped_column(Boolean, default=False)
    all_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class KmsKey(Base):
    __tablename__ = "kms_keys"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    key_id: Mapped[str] = mapped_column(String(64))
    arn: Mapped[str] = mapped_column(String(512))
    alias: Mapped[str | None] = mapped_column(String(256), nullable=True)
    rotation_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    has_wildcard_principal: Mapped[bool] = mapped_column(Boolean, default=False)
    key_state: Mapped[str | None] = mapped_column(String(40), nullable=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        __import__("sqlalchemy").UniqueConstraint("account_id", "arn"),
    )


class CloudTrailTrail(Base):
    __tablename__ = "cloudtrail_trails"
    __table_args__ = (UniqueConstraint("account_id", "arn"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    arn: Mapped[str] = mapped_column(String(512))
    name: Mapped[str] = mapped_column(String(256))
    home_region: Mapped[str] = mapped_column(String(40))
    is_multi_region: Mapped[bool] = mapped_column(Boolean, default=False)
    is_logging: Mapped[bool] = mapped_column(Boolean, default=False)
    log_validation_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    kms_key_id: Mapped[str | None] = mapped_column(String(512), nullable=True)
    s3_bucket_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    s3_bucket_public: Mapped[bool] = mapped_column(Boolean, default=False)
    s3_bucket_logging_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    cloudwatch_logs_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    is_organization_trail: Mapped[bool] = mapped_column(Boolean, default=False)
    management_account_id: Mapped[str | None] = mapped_column(String(20), nullable=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GuardDutyDetector(Base):
    __tablename__ = "guardduty_detectors"
    __table_args__ = (UniqueConstraint("account_id", "detector_id", "region"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    detector_id: Mapped[str] = mapped_column(String(64))
    region: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20))  # ENABLED | DISABLED
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Vpc(Base):
    __tablename__ = "vpcs"
    __table_args__ = (UniqueConstraint("account_id", "vpc_id", "region"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    vpc_id: Mapped[str] = mapped_column(String(64))
    region: Mapped[str] = mapped_column(String(40))
    flow_logs_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SecurityGroup(Base):
    __tablename__ = "security_groups"
    __table_args__ = (UniqueConstraint("account_id", "group_id", "region"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[str] = mapped_column(String(64))
    group_name: Mapped[str] = mapped_column(String(256))
    region: Mapped[str] = mapped_column(String(40))
    vpc_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    unrestricted_ssh: Mapped[bool] = mapped_column(Boolean, default=False)
    unrestricted_rdp: Mapped[bool] = mapped_column(Boolean, default=False)
    public_exposure: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    has_any_inbound_rules: Mapped[bool] = mapped_column(Boolean, default=False)
    has_any_outbound_rules: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Ec2Instance(Base):
    __tablename__ = "ec2_instances"
    __table_args__ = (UniqueConstraint("account_id", "region", "instance_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    instance_id: Mapped[str] = mapped_column(String(64))
    region: Mapped[str] = mapped_column(String(40))
    instance_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    state: Mapped[str] = mapped_column(String(20))
    imdsv2_required: Mapped[bool] = mapped_column(Boolean, default=False)
    vpc_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    subnet_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    security_group_ids: Mapped[list] = mapped_column(JSON, default=list)
    tags: Mapped[dict] = mapped_column(JSON, default=dict)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EbsVolume(Base):
    __tablename__ = "ebs_volumes"
    __table_args__ = (UniqueConstraint("account_id", "region", "volume_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    region: Mapped[str] = mapped_column(String(40))
    volume_id: Mapped[str] = mapped_column(String(64))
    arn: Mapped[str] = mapped_column(String(512))
    encrypted: Mapped[bool] = mapped_column(Boolean, default=False)
    state: Mapped[str] = mapped_column(String(40))
    size_gib: Mapped[int | None] = mapped_column(Integer, nullable=True)
    volume_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    attached_instance_ids: Mapped[list] = mapped_column(JSON, default=list)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EbsEncryptionDefault(Base):
    __tablename__ = "ebs_encryption_defaults"
    __table_args__ = (UniqueConstraint("account_id", "region"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    region: Mapped[str] = mapped_column(String(40))
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AccountGovernance(Base):
    """AWS account contact / alternate contact state (CIS 1.1, 1.2)."""

    __tablename__ = "account_governance"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("aws_accounts.id", ondelete="CASCADE"), unique=True, index=True
    )
    primary_contact_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    security_contact_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    collection_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    contact_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class IamServerCertificate(Base):
    __tablename__ = "iam_server_certificates"
    __table_args__ = (UniqueConstraint("account_id", "arn"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(256))
    arn: Mapped[str] = mapped_column(String(512))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class IamPasswordPolicy(Base):
    __tablename__ = "iam_password_policies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), unique=True, index=True)
    exists: Mapped[bool] = mapped_column(Boolean, default=False)
    min_length: Mapped[int | None] = mapped_column(Integer, nullable=True)
    require_uppercase: Mapped[bool] = mapped_column(Boolean, default=False)
    require_lowercase: Mapped[bool] = mapped_column(Boolean, default=False)
    require_numbers: Mapped[bool] = mapped_column(Boolean, default=False)
    require_symbols: Mapped[bool] = mapped_column(Boolean, default=False)
    max_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    password_reuse_prevention: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AccessAnalyzer(Base):
    __tablename__ = "access_analyzers"
    __table_args__ = (UniqueConstraint("account_id", "region"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    region: Mapped[str] = mapped_column(String(40))
    analyzer_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    status: Mapped[str] = mapped_column(String(20))
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ConfigRecorder(Base):
    __tablename__ = "config_recorders"
    __table_args__ = (UniqueConstraint("account_id", "region"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    region: Mapped[str] = mapped_column(String(40))
    recorder_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    recording: Mapped[bool] = mapped_column(Boolean, default=False)
    delivery_channel_exists: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SecurityHubStatus(Base):
    __tablename__ = "security_hub_statuses"
    __table_args__ = (UniqueConstraint("account_id", "region"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    region: Mapped[str] = mapped_column(String(40))
    hub_arn: Mapped[str | None] = mapped_column(String(512), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RdsInstance(Base):
    __tablename__ = "rds_instances"
    __table_args__ = (UniqueConstraint("account_id", "arn"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    db_instance_id: Mapped[str] = mapped_column(String(256))
    arn: Mapped[str] = mapped_column(String(512))
    region: Mapped[str] = mapped_column(String(40))
    publicly_accessible: Mapped[bool] = mapped_column(Boolean, default=False)
    storage_encrypted: Mapped[bool] = mapped_column(Boolean, default=False)
    backup_retention_period: Mapped[int] = mapped_column(Integer, default=0)
    engine: Mapped[str | None] = mapped_column(String(64), nullable=True)
    multi_az: Mapped[bool] = mapped_column(Boolean, default=False)
    deletion_protection: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EbsSnapshot(Base):
    __tablename__ = "ebs_snapshots"
    __table_args__ = (UniqueConstraint("account_id", "region", "snapshot_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    region: Mapped[str] = mapped_column(String(40))
    snapshot_id: Mapped[str] = mapped_column(String(64))
    arn: Mapped[str] = mapped_column(String(512))
    encrypted: Mapped[bool] = mapped_column(Boolean, default=False)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Ec2Ami(Base):
    __tablename__ = "ec2_amis"
    __table_args__ = (UniqueConstraint("account_id", "region", "image_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    region: Mapped[str] = mapped_column(String(40))
    image_id: Mapped[str] = mapped_column(String(64))
    arn: Mapped[str] = mapped_column(String(512))
    name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GuardDutyFinding(Base):
    __tablename__ = "guardduty_findings"
    __table_args__ = (UniqueConstraint("account_id", "region", "finding_id", name="uq_guardduty_finding"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    region: Mapped[str] = mapped_column(String(40))
    finding_id: Mapped[str] = mapped_column(String(64))
    finding_type: Mapped[str | None] = mapped_column(String(256), nullable=True)
    severity: Mapped[str] = mapped_column(String(20))
    title: Mapped[str | None] = mapped_column(String(512), nullable=True)
    resource_arn: Mapped[str | None] = mapped_column(String(512), nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class IdentityCenterUser(Base):
    __tablename__ = "identity_center_users"
    __table_args__ = (UniqueConstraint("account_id", "identity_store_id", "user_id", name="uq_identity_center_user"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    identity_store_id: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[str] = mapped_column(String(64))
    user_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ConfigRuleCompliance(Base):
    __tablename__ = "config_rule_compliance"
    __table_args__ = (UniqueConstraint("account_id", "region", "rule_name", name="uq_config_rule_compliance"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    region: Mapped[str] = mapped_column(String(40))
    rule_name: Mapped[str] = mapped_column(String(256))
    compliance_type: Mapped[str] = mapped_column(String(40))
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AcmCertificate(Base):
    __tablename__ = "acm_certificates"
    __table_args__ = (UniqueConstraint("account_id", "certificate_arn"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    region: Mapped[str] = mapped_column(String(40))
    certificate_arn: Mapped[str] = mapped_column(String(512))
    domain_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LambdaFunction(Base):
    __tablename__ = "lambda_functions"
    __table_args__ = (UniqueConstraint("account_id", "arn"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    region: Mapped[str] = mapped_column(String(40))
    function_name: Mapped[str] = mapped_column(String(256))
    arn: Mapped[str] = mapped_column(String(512))
    runtime: Mapped[str | None] = mapped_column(String(64), nullable=True)
    has_dlq: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SecretsManagerSecret(Base):
    __tablename__ = "secrets_manager_secrets"
    __table_args__ = (UniqueConstraint("account_id", "secret_arn"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    region: Mapped[str] = mapped_column(String(40))
    secret_arn: Mapped[str] = mapped_column(String(512))
    name: Mapped[str] = mapped_column(String(512))
    rotation_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SsmParameter(Base):
    __tablename__ = "ssm_parameters"
    __table_args__ = (UniqueConstraint("account_id", "region", "parameter_name"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    region: Mapped[str] = mapped_column(String(40))
    parameter_name: Mapped[str] = mapped_column(String(512))
    parameter_type: Mapped[str] = mapped_column(String(40))
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ElbLoadBalancer(Base):
    __tablename__ = "elb_load_balancers"
    __table_args__ = (UniqueConstraint("account_id", "load_balancer_arn"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    region: Mapped[str] = mapped_column(String(40))
    load_balancer_arn: Mapped[str] = mapped_column(String(512))
    name: Mapped[str] = mapped_column(String(256))
    lb_type: Mapped[str] = mapped_column(String(20))
    access_logs_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    ssl_policy: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DynamoDbTable(Base):
    __tablename__ = "dynamodb_tables"
    __table_args__ = (UniqueConstraint("account_id", "arn"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    region: Mapped[str] = mapped_column(String(40))
    table_name: Mapped[str] = mapped_column(String(256))
    arn: Mapped[str] = mapped_column(String(512))
    pitr_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    kms_encrypted: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SnsTopic(Base):
    __tablename__ = "sns_topics"
    __table_args__ = (UniqueConstraint("account_id", "topic_arn"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    region: Mapped[str] = mapped_column(String(40))
    topic_arn: Mapped[str] = mapped_column(String(512))
    kms_encrypted: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SqsQueue(Base):
    __tablename__ = "sqs_queues"
    __table_args__ = (UniqueConstraint("account_id", "queue_arn"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("aws_accounts.id", ondelete="CASCADE"), index=True)
    region: Mapped[str] = mapped_column(String(40))
    queue_url: Mapped[str] = mapped_column(String(512))
    queue_arn: Mapped[str] = mapped_column(String(512))
    kms_encrypted: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
