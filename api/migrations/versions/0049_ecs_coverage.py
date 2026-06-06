"""ECS cluster, service, and task definition coverage.

Revision ID: 0049
Revises: 0048
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ecs_clusters",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("aws_accounts.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("region", sa.String(40), nullable=False),
        sa.Column("name", sa.String(256), nullable=False),
        sa.Column("arn", sa.String(512), nullable=False),
        sa.Column("container_insights_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("status", sa.String(64), nullable=True),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("account_id", "arn"),
    )
    op.create_table(
        "ecs_services",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("aws_accounts.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("region", sa.String(40), nullable=False),
        sa.Column("cluster_arn", sa.String(512), nullable=False),
        sa.Column("cluster_name", sa.String(256), nullable=False),
        sa.Column("service_name", sa.String(256), nullable=False),
        sa.Column("service_arn", sa.String(512), nullable=False),
        sa.Column("assign_public_ip", sa.String(16), nullable=True),
        sa.Column("launch_type", sa.String(32), nullable=True),
        sa.Column("status", sa.String(64), nullable=True),
        sa.Column("task_definition_arn", sa.String(512), nullable=True),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("account_id", "service_arn"),
    )
    op.create_table(
        "ecs_task_definitions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("aws_accounts.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("region", sa.String(40), nullable=False),
        sa.Column("task_definition_arn", sa.String(512), nullable=False),
        sa.Column("family", sa.String(256), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=True),
        sa.Column("has_privileged_container", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("account_id", "task_definition_arn"),
    )


def downgrade():
    op.drop_table("ecs_task_definitions")
    op.drop_table("ecs_services")
    op.drop_table("ecs_clusters")
