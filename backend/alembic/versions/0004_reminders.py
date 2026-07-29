"""reminders outbox

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-29

"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "reminders",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "note_id",
            sa.Integer,
            sa.ForeignKey("notes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("note_date", sa.Date, nullable=False),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text, nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("note_id", "note_date", name="uq_reminders_note_occurrence"),
    )
    op.create_index("ix_reminders_user_id", "reminders", ["user_id"])
    op.create_index("ix_reminders_note_id", "reminders", ["note_id"])
    op.create_index("ix_reminders_status_scheduled_for", "reminders", ["status", "scheduled_for"])


def downgrade():
    op.drop_index("ix_reminders_status_scheduled_for", "reminders")
    op.drop_index("ix_reminders_note_id", "reminders")
    op.drop_index("ix_reminders_user_id", "reminders")
    op.drop_table("reminders")
