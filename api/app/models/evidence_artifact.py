"""User-uploaded evidence mapped to controls or composite groups."""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

EVIDENCE_STATUSES = frozenset({"submitted", "accepted", "expired"})


class EvidenceArtifact(Base):
    __tablename__ = "evidence_artifacts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orgs.id", ondelete="CASCADE"), index=True)
    control_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("controls.id", ondelete="SET NULL"), index=True, nullable=True
    )
    composite_control_id: Mapped[str | None] = mapped_column(String(80), index=True, nullable=True)
    check_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    framework: Mapped[str] = mapped_column(String(40), index=True)
    control_ref: Mapped[str | None] = mapped_column(String(40), nullable=True)
    title: Mapped[str] = mapped_column(String(300))
    source: Mapped[str | None] = mapped_column(String(120), nullable=True)
    evidence_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    external_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    owner: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="submitted", nullable=False)
    expires_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    filename: Mapped[str | None] = mapped_column(String(300), nullable=True)
    storage_path: Mapped[str | None] = mapped_column(String(700), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(160), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    suggested_mappings: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
