"""Add org_saml_configs for per-org SAML SSO."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0045_org_saml_config"
down_revision = "0044_org_trail_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "org_saml_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "org_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orgs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("slug", sa.String(60), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("idp_entity_id", sa.String(500), nullable=False, server_default=""),
        sa.Column("idp_sso_url", sa.String(1000), nullable=False, server_default=""),
        sa.Column("idp_x509_cert", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_unique_constraint("uq_org_saml_configs_org_id", "org_saml_configs", ["org_id"])
    op.create_unique_constraint("uq_org_saml_configs_slug", "org_saml_configs", ["slug"])
    op.create_index("ix_org_saml_configs_slug", "org_saml_configs", ["slug"])


def downgrade() -> None:
    op.drop_index("ix_org_saml_configs_slug", table_name="org_saml_configs")
    op.drop_constraint("uq_org_saml_configs_slug", "org_saml_configs", type_="unique")
    op.drop_constraint("uq_org_saml_configs_org_id", "org_saml_configs", type_="unique")
    op.drop_table("org_saml_configs")
