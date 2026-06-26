"""Upgrade Cloud Castles workspace to Growth plan (10 connected accounts).

Revision ID: 0075
Revises: 0074
Create Date: 2026-06-26
"""
import sqlalchemy as sa
from alembic import op

revision = "0075"
down_revision = "0074"
branch_labels = None
depends_on = None

_GROWTH_PLAN = "growth"


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            UPDATE orgs
            SET plan = :plan
            WHERE slug = 'cloud-castles'
               OR lower(name) IN ('cloud castles', 'cloud-castles')
            """
        ),
        {"plan": _GROWTH_PLAN},
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            UPDATE orgs
            SET plan = 'trial'
            WHERE slug = 'cloud-castles'
               OR lower(name) IN ('cloud castles', 'cloud-castles')
            """
        ),
    )
