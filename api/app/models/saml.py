"""Per-org SAML 2.0 IdP configuration for SP-initiated enterprise SSO."""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class OrgSamlConfig(Base):
    __tablename__ = "org_saml_configs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("orgs.id", ondelete="CASCADE"), unique=True, index=True, nullable=False
    )
    # URL-safe identifier for the SP-initiated login route: /v1/auth/saml/{slug}/login
    slug: Mapped[str] = mapped_column(String(60), unique=True, index=True, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    idp_entity_id: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    idp_sso_url: Mapped[str] = mapped_column(String(1000), default="", nullable=False)
    # IdP signing certificate (PEM body, public) — not secret, stored in plaintext.
    idp_x509_cert: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
