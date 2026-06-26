"""GCP Workload Identity Federation auth fields.

Revision ID: 0076
Revises: 0075
Create Date: 2026-06-26
"""
import sqlalchemy as sa
from alembic import op

revision = "0076"
down_revision = "0075"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "gcp_projects",
        sa.Column("auth_method", sa.String(length=40), nullable=False, server_default="workload_identity"),
    )
    op.add_column("gcp_projects", sa.Column("project_number", sa.String(length=40), nullable=True))
    op.add_column("gcp_projects", sa.Column("pool_id", sa.String(length=120), nullable=True))
    op.add_column("gcp_projects", sa.Column("provider_id", sa.String(length=120), nullable=True))
    op.add_column("gcp_projects", sa.Column("service_account_email", sa.String(length=320), nullable=True))
    op.add_column("gcp_projects", sa.Column("wif_audience", sa.String(length=500), nullable=True))
    op.add_column("gcp_projects", sa.Column("wif_subject", sa.String(length=200), nullable=True))
    op.alter_column("gcp_projects", "service_account_json", existing_type=sa.String(length=8000), nullable=True)


def downgrade() -> None:
    op.alter_column("gcp_projects", "service_account_json", existing_type=sa.String(length=8000), nullable=False)
    op.drop_column("gcp_projects", "wif_subject")
    op.drop_column("gcp_projects", "wif_audience")
    op.drop_column("gcp_projects", "service_account_email")
    op.drop_column("gcp_projects", "provider_id")
    op.drop_column("gcp_projects", "pool_id")
    op.drop_column("gcp_projects", "project_number")
    op.drop_column("gcp_projects", "auth_method")
