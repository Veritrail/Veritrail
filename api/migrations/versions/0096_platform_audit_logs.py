"""Platform-level audit log for the platform-admin surface (who/what/when/IP).

Revision ID: 0096
Revises: 0095
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0096"
down_revision = "0095"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_audit_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "actor_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("actor_email", sa.String(320), nullable=True),
        sa.Column("action", sa.String(80), nullable=False),
        sa.Column("method", sa.String(10), nullable=False, server_default="GET"),
        sa.Column("endpoint", sa.String(300), nullable=False),
        sa.Column("source_ip", sa.String(64), nullable=True),
        sa.Column("allowed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("detail", JSONB, nullable=False, server_default="{}"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_platform_audit_logs_actor_user_id", "platform_audit_logs", ["actor_user_id"])
    op.create_index("ix_platform_audit_logs_created_at", "platform_audit_logs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_platform_audit_logs_created_at", table_name="platform_audit_logs")
    op.drop_index("ix_platform_audit_logs_actor_user_id", table_name="platform_audit_logs")
    op.drop_table("platform_audit_logs")
