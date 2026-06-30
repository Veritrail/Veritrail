"""Add framework-mapping metadata columns to controls.

Revision ID: 0078
Revises: 0077
Create Date: 2026-07-01
"""
from alembic import op
import sqlalchemy as sa

revision = "0078"
down_revision = "0077"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("controls", sa.Column("soc2_scope_category", sa.String(length=40), nullable=True))
    op.add_column("controls", sa.Column("cis_profile_level", sa.String(length=20), nullable=True))
    op.add_column("controls", sa.Column("iso_applicability", sa.String(length=20), nullable=True))
    op.add_column("controls", sa.Column("iso_applicability_rationale", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("controls", "iso_applicability_rationale")
    op.drop_column("controls", "iso_applicability")
    op.drop_column("controls", "cis_profile_level")
    op.drop_column("controls", "soc2_scope_category")
