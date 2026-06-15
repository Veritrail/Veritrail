"""DNS-verifiable org email domains + auto-join."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0058"
down_revision = "0057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "org_domains",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("domain", sa.String(length=253), nullable=False),
        sa.Column("verification_token", sa.String(length=80), nullable=False),
        sa.Column("verified", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("auto_join_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("auto_join_role", sa.String(length=40), nullable=False, server_default="viewer"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_org_domains_org_id", "org_domains", ["org_id"])
    op.create_index("ix_org_domains_domain", "org_domains", ["domain"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_org_domains_domain", table_name="org_domains")
    op.drop_index("ix_org_domains_org_id", table_name="org_domains")
    op.drop_table("org_domains")
