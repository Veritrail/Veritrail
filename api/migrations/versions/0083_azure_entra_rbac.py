"""Azure Entra / RBAC privileged role assignment collector.

Revision ID: 0083
Revises: 0082
Create Date: 2026-07-03
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0083"
down_revision = "0082"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "azure_privileged_role_assignments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "azure_subscription_id",
            UUID(as_uuid=True),
            sa.ForeignKey("azure_subscriptions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("assignment_id", sa.String(length=200), nullable=False),
        sa.Column("role_name", sa.String(length=120), nullable=False),
        sa.Column("role_definition_id", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("principal_id", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("principal_type", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("scope", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint(
            "azure_subscription_id",
            "assignment_id",
            name="uq_azure_rbac_subscription_assignment",
        ),
    )
    op.create_index(
        "ix_azure_privileged_role_assignments_azure_subscription_id",
        "azure_privileged_role_assignments",
        ["azure_subscription_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_azure_privileged_role_assignments_azure_subscription_id",
        table_name="azure_privileged_role_assignments",
    )
    op.drop_table("azure_privileged_role_assignments")
