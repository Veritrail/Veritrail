"""Workspace-level declared external evidence sources (one row per category)."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class EvidenceSource(Base):
    __tablename__ = "evidence_sources"
    __table_args__ = (UniqueConstraint("org_id", "category_key", name="uq_evidence_sources_org_category"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orgs.id", ondelete="CASCADE"), index=True)
    category_key: Mapped[str] = mapped_column(String(80), nullable=False)
    vendor: Mapped[str] = mapped_column(String(120), nullable=False)
    owner: Mapped[str | None] = mapped_column(String(200), nullable=True)
    cadence: Mapped[str | None] = mapped_column(String(80), nullable=True)
    scope_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
