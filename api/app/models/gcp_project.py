import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.encryption import EncryptedString


class GcpProject(Base):
    __tablename__ = "gcp_projects"
    __table_args__ = (UniqueConstraint("org_id", "project_id", name="uq_gcp_projects_org_project"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orgs.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(String(120), nullable=False)
    label: Mapped[str] = mapped_column(String(200), default="")
    auth_method: Mapped[str] = mapped_column(String(40), default="workload_identity")
    project_number: Mapped[str | None] = mapped_column(String(40), nullable=True)
    pool_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    provider_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    service_account_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    wif_audience: Mapped[str | None] = mapped_column(String(500), nullable=True)
    wif_subject: Mapped[str | None] = mapped_column(String(200), nullable=True)
    service_account_json: Mapped[str | None] = mapped_column(EncryptedString(8000), nullable=True)
    status: Mapped[str] = mapped_column(String(40), default="pending")  # pending|connected|error
    last_scan_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GcpComputeInstance(Base):
    __tablename__ = "gcp_compute_instances"
    __table_args__ = (
        UniqueConstraint("gcp_project_id", "instance_id", name="uq_gcp_compute_project_instance"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    gcp_project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("gcp_projects.id", ondelete="CASCADE"), index=True
    )
    instance_id: Mapped[str] = mapped_column(String(200), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    zone: Mapped[str] = mapped_column(String(80), nullable=False)
    has_public_ip: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GcpLoggingAudit(Base):
    __tablename__ = "gcp_logging_audit"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    gcp_project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("gcp_projects.id", ondelete="CASCADE"), unique=True
    )
    audit_logging_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    sink_count: Mapped[int] = mapped_column(Integer, default=0)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
