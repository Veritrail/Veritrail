"""Platform-admin workspace creation invites.

Revision ID: 0097
Revises: 0096
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0097"
down_revision = "0096"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspace_creation_invites",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("org_name", sa.String(200), nullable=True),
        sa.Column("plan", sa.String(40), nullable=False, server_default="trial"),
        sa.Column("token", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_org_id",
            UUID(as_uuid=True),
            sa.ForeignKey("orgs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_workspace_creation_invites_email", "workspace_creation_invites", ["email"])
    op.create_index("ix_workspace_creation_invites_token", "workspace_creation_invites", ["token"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_workspace_creation_invites_token", table_name="workspace_creation_invites")
    op.drop_index("ix_workspace_creation_invites_email", table_name="workspace_creation_invites")
    op.drop_table("workspace_creation_invites")
