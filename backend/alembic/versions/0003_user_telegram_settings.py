"""user telegram settings

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-29

"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    # server_default is required on every NOT NULL column: without it add_column fails
    # on tables that already hold rows.
    op.add_column(
        "users",
        sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
    )
    op.add_column(
        "users",
        sa.Column("reminder_time", sa.Time, nullable=False, server_default="09:00:00"),
    )
    op.add_column(
        "users",
        sa.Column(
            "notifications_enabled", sa.Boolean, nullable=False, server_default=sa.false()
        ),
    )
    op.add_column("users", sa.Column("telegram_chat_id", sa.BigInteger, nullable=True))
    op.add_column("users", sa.Column("telegram_username", sa.String(32), nullable=True))
    op.add_column(
        "users", sa.Column("telegram_linked_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("users", sa.Column("telegram_link_code", sa.String(43), nullable=True))
    op.add_column(
        "users",
        sa.Column("telegram_link_code_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_unique_constraint("uq_users_telegram_chat_id", "users", ["telegram_chat_id"])
    op.create_unique_constraint("uq_users_telegram_link_code", "users", ["telegram_link_code"])


def downgrade():
    op.drop_constraint("uq_users_telegram_link_code", "users", type_="unique")
    op.drop_constraint("uq_users_telegram_chat_id", "users", type_="unique")
    op.drop_column("users", "telegram_link_code_expires_at")
    op.drop_column("users", "telegram_link_code")
    op.drop_column("users", "telegram_linked_at")
    op.drop_column("users", "telegram_username")
    op.drop_column("users", "telegram_chat_id")
    op.drop_column("users", "notifications_enabled")
    op.drop_column("users", "reminder_time")
    op.drop_column("users", "timezone")
