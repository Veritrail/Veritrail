import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
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
