"""Add users.mfa_backup_codes for MFA recovery codes."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0046_user_mfa_backup_codes"
down_revision = "0045_org_saml_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("mfa_backup_codes", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "mfa_backup_codes")
