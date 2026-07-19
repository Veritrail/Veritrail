"""Platform-level (cross-org) audit trail for the platform-admin surface.

Separate from OrgActivityLog on purpose: platform-admin actions span every
workspace, so rows must not be scoped to (or visible inside) any single org.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class PlatformAuditLog(Base):
    __tablename__ = "platform_audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Denormalized so rows stay attributable after the user row is deleted.
    actor_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    action: Mapped[str] = mapped_column(String(80))
    method: Mapped[str] = mapped_column(String(10), default="GET")
    endpoint: Mapped[str] = mapped_column(String(300))
    source_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    allowed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    detail: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
