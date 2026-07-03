"""Phase 9 deferred P4 models."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class VaultExportShare(Base):
    __tablename__ = "vault_export_shares"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), index=True, nullable=False
    )
    export_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidence_exports.id", ondelete="CASCADE"), index=True, nullable=False
    )
    auditor_access_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("auditor_accesses.id", ondelete="CASCADE"), nullable=False
    )
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    link_type: Mapped[str] = mapped_column(String(40), nullable=False)
    share_url: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OrgFramework(Base):
    __tablename__ = "org_frameworks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), index=True, nullable=False
    )
    slug: Mapped[str] = mapped_column(String(40), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    control_definitions: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint("org_id", "slug", name="uq_org_frameworks_org_slug"),)


class EvidenceRequirement(Base):
    __tablename__ = "evidence_requirements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), index=True, nullable=False
    )
    framework: Mapped[str] = mapped_column(String(40), nullable=False)
    composite_control_id: Mapped[str] = mapped_column(String(80), nullable=False)
    requirement_key: Mapped[str] = mapped_column(String(80), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    category_key: Mapped[str | None] = mapped_column(String(40), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint(
            "org_id",
            "framework",
            "composite_control_id",
            "requirement_key",
            name="uq_evidence_requirements_org_fw_composite_key",
        ),
    )


class ControlCoverage(Base):
    __tablename__ = "control_coverages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), index=True, nullable=False
    )
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("aws_accounts.id", ondelete="CASCADE"), nullable=True
    )
    framework: Mapped[str] = mapped_column(String(40), nullable=False)
    control_id: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    coverage_source: Mapped[str] = mapped_column(String(40), nullable=False)
    details: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint(
            "org_id",
            "account_id",
            "framework",
            "control_id",
            name="uq_control_coverages_org_account_fw_control",
        ),
    )


class MdmDeviceSnapshot(Base):
    __tablename__ = "mdm_device_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("identity_providers.id", ondelete="CASCADE"), index=True, nullable=False
    )
    external_id: Mapped[str] = mapped_column(String(120), nullable=False)
    device_name: Mapped[str | None] = mapped_column(String(320), nullable=True)
    platform: Mapped[str | None] = mapped_column(String(40), nullable=True)
    encrypted: Mapped[bool | None] = mapped_column(Boolean(), nullable=True)
    compliant: Mapped[bool | None] = mapped_column(Boolean(), nullable=True)
    last_sync_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("provider_id", "external_id", name="uq_mdm_device_provider_external"),)
