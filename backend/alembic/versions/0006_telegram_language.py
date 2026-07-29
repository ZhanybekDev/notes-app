"""remember the Telegram client language for bot messages

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-30

"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    # Nullable because Telegram only sends language_code when the client reports one, and because
    # accounts linked before this migration have nothing to backfill from. A null falls back to
    # English, same as the frontend does for a missing translation.
    op.add_column("users", sa.Column("telegram_language", sa.String(8), nullable=True))


def downgrade():
    op.drop_column("users", "telegram_language")
