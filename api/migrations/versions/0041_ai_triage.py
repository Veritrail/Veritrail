from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0041_ai_triage"
down_revision = "0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_triage_results",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("finding_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("confidence_score", sa.Float(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column(
            "suggested_action",
            sa.String(20),
            nullable=False,
        ),
        sa.Column("findings_context", postgresql.JSONB(), server_default="{}", nullable=False),
        sa.Column("model_version", sa.String(80), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["finding_id"],
            ["findings.id"],
            name="ai_triage_results_finding_id_fkey",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_ai_triage_results_finding_id"),
        "ai_triage_results",
        ["finding_id"],
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_ai_triage_results_finding_id"), table_name="ai_triage_results")
    op.drop_table("ai_triage_results")
