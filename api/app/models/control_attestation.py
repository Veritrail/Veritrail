"""Org-level manual attestation of a control with no automated checks."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

ATTESTATION_STATUSES = frozenset({"met", "not_met", "not_applicable", "pending"})


class ControlAttestation(Base):
    """A workspace's manual sign-off on a control that Veritrail cannot prove with an
    automated check (governance / HR / risk / policy SOC 2 criteria). Combined
    with auto-derived control status to produce the workspace readiness %."""

    __tablename__ = "control_attestations"
    __table_args__ = (UniqueConstraint("org_id", "control_id", name="uq_control_attestation_org_control"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orgs.id", ondelete="CASCADE"), index=True)
    control_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("controls.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    owner: Mapped[str | None] = mapped_column(String(200), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_filename: Mapped[str | None] = mapped_column(String(300), nullable=True)
    evidence_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
