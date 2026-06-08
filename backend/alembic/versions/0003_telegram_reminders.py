"""telegram reminders

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-02

"""

from alembic import op
import sqlalchemy as sa


revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("telegram_chat_id", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("telegram_username", sa.String(length=64), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "telegram_notifications_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column("users", sa.Column("telegram_link_code", sa.String(length=32), nullable=True))
    op.add_column(
        "users",
        sa.Column("telegram_link_code_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_users_telegram_chat_id", "users", ["telegram_chat_id"], unique=True)
    op.create_index("ix_users_telegram_link_code", "users", ["telegram_link_code"], unique=True)

    op.add_column("notes", sa.Column("reminder_sent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("notes", sa.Column("reminder_sent_for_date", sa.Date(), nullable=True))


def downgrade():
    op.drop_column("notes", "reminder_sent_for_date")
    op.drop_column("notes", "reminder_sent_at")

    op.drop_index("ix_users_telegram_link_code", table_name="users")
    op.drop_index("ix_users_telegram_chat_id", table_name="users")
    op.drop_column("users", "telegram_link_code_expires_at")
    op.drop_column("users", "telegram_link_code")
    op.drop_column("users", "telegram_notifications_enabled")
    op.drop_column("users", "telegram_username")
    op.drop_column("users", "telegram_chat_id")
