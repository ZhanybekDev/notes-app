"""read-only share links for single notes

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-30

"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    # A column on `notes` rather than a table: one live link per note, and revoking is setting it
    # back to NULL. A table would buy link history and expiry, neither of which the feature has.
    op.add_column("notes", sa.Column("share_token", sa.String(64), nullable=True))
    op.add_column("notes", sa.Column("shared_at", sa.DateTime(timezone=True), nullable=True))
    # Unique so a collision fails loudly instead of handing one link to two notes, and an index
    # because the public read looks a note up by this column and nothing else.
    op.create_index("ix_notes_share_token", "notes", ["share_token"], unique=True)


def downgrade():
    op.drop_index("ix_notes_share_token", table_name="notes")
    op.drop_column("notes", "shared_at")
    op.drop_column("notes", "share_token")
