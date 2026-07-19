import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.encryption import EncryptedString


class AzureSubscription(Base):
    __tablename__ = "azure_subscriptions"
    __table_args__ = (
        UniqueConstraint("org_id", "subscription_id", name="uq_azure_subscriptions_org_subscription"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orgs.id", ondelete="CASCADE"), index=True)
    subscription_id: Mapped[str] = mapped_column(String(80), nullable=False)
    tenant_id: Mapped[str] = mapped_column(String(80), nullable=False)
    client_id: Mapped[str] = mapped_column(String(80), nullable=False)
    client_secret: Mapped[str] = mapped_column(EncryptedString(2000), nullable=False)
    label: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(40), default="pending")  # pending|connected|error
    last_scan_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AzureDefenderStatus(Base):
    __tablename__ = "azure_defender_status"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    azure_subscription_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("azure_subscriptions.id", ondelete="CASCADE"), unique=True
    )
    secure_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    pricing_tier: Mapped[str | None] = mapped_column(String(40), nullable=True)
    defender_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    evidence_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AzureStorageAccount(Base):
    __tablename__ = "azure_storage_accounts"
    __table_args__ = (
        UniqueConstraint(
            "azure_subscription_id",
            "account_name",
            name="uq_azure_storage_subscription_account",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    azure_subscription_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("azure_subscriptions.id", ondelete="CASCADE"), index=True
    )
    account_name: Mapped[str] = mapped_column(String(120), nullable=False)
    resource_group: Mapped[str] = mapped_column(String(120), nullable=False)
    public_blob_access: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AzureActivityLogSettings(Base):
    __tablename__ = "azure_activity_log_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    azure_subscription_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("azure_subscriptions.id", ondelete="CASCADE"), unique=True
    )
    activity_log_export_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    diagnostic_settings_count: Mapped[int] = mapped_column(Integer, default=0)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AzurePrivilegedRoleAssignment(Base):
    __tablename__ = "azure_privileged_role_assignments"
    __table_args__ = (
        UniqueConstraint(
            "azure_subscription_id",
            "assignment_id",
            name="uq_azure_rbac_subscription_assignment",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    azure_subscription_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("azure_subscriptions.id", ondelete="CASCADE"), index=True
    )
    assignment_id: Mapped[str] = mapped_column(String(200), nullable=False)
    role_name: Mapped[str] = mapped_column(String(120), nullable=False)
    role_definition_id: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    principal_id: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    principal_type: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    scope: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AzurePolicyCompliance(Base):
    __tablename__ = "azure_policy_compliance"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    azure_subscription_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("azure_subscriptions.id", ondelete="CASCADE"), unique=True
    )
    policy_insights_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    non_compliant_count: Mapped[int] = mapped_column(Integer, default=0)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AzurePolicyNonCompliance(Base):
    __tablename__ = "azure_policy_non_compliance"
    __table_args__ = (
        UniqueConstraint(
            "azure_subscription_id",
            "policy_state_id",
            name="uq_azure_policy_subscription_state",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    azure_subscription_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("azure_subscriptions.id", ondelete="CASCADE"), index=True
    )
    policy_state_id: Mapped[str] = mapped_column(String(500), nullable=False)
    policy_definition_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    policy_assignment_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    resource_id: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    resource_type: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    compliance_state: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AzureComputeInstance(Base):
    __tablename__ = "azure_compute_instances"
    __table_args__ = (
        UniqueConstraint(
            "azure_subscription_id",
            "vm_id",
            name="uq_azure_compute_subscription_vm",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    azure_subscription_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("azure_subscriptions.id", ondelete="CASCADE"), index=True
    )
    vm_id: Mapped[str] = mapped_column(String(500), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    resource_group: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    location: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    has_public_ip: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
