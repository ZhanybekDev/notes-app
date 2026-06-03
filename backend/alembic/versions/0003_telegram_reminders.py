"""telegram reminders

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-03

"""
from alembic import op
import sqlalchemy as sa


revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users",
        sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
    )
    op.add_column(
        "users",
        sa.Column("telegram_chat_id", sa.String(32), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "telegram_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "users",
        sa.Column("telegram_link_code", sa.String(32), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("telegram_link_code_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_users_telegram_link_code", "users", ["telegram_link_code"])

    op.create_table(
        "reminders_sent",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "note_id",
            sa.Integer,
            sa.ForeignKey("notes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("note_date", sa.Date, nullable=False),
        sa.Column(
            "sent_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("note_id", "note_date", name="uq_reminders_sent_note_date"),
    )
    op.create_index("ix_reminders_sent_note_id", "reminders_sent", ["note_id"])


def downgrade():
    op.drop_index("ix_reminders_sent_note_id", "reminders_sent")
    op.drop_table("reminders_sent")
    op.drop_index("ix_users_telegram_link_code", "users")
    op.drop_column("users", "telegram_link_code_expires_at")
    op.drop_column("users", "telegram_link_code")
    op.drop_column("users", "telegram_enabled")
    op.drop_column("users", "telegram_chat_id")
    op.drop_column("users", "timezone")
