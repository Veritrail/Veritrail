"""Per-org overrides for framework control → check_id mappings (Phase 7)."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

FRAMEWORKS = frozenset({"soc2", "cis_aws_l1", "iso27001"})


class OrgControlMapping(Base):
    """Org-specific add/remove lists layered on global control_mappings.json.

    Effective checks = (global ∪ added_check_ids) − removed_check_ids.
    """

    __tablename__ = "org_control_mappings"
    __table_args__ = (UniqueConstraint("org_id", "framework", "control_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), index=True
    )
    framework: Mapped[str] = mapped_column(String(40), index=True)
    control_id: Mapped[str] = mapped_column(String(30), index=True)
    added_check_ids: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    removed_check_ids: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
