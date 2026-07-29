"""composite (note_date, id) index for the reminder sweep

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-29

"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    # The sweep filters a date range, orders by (note_date, id) and resumes from a cursor on the
    # same pair. One composite index serves all three; the single-column index it replaces is
    # redundant because note_date leads.
    op.create_index("ix_notes_note_date_id", "notes", ["note_date", "id"])
    op.drop_index("ix_notes_note_date", "notes")


def downgrade():
    op.create_index("ix_notes_note_date", "notes", ["note_date"])
    op.drop_index("ix_notes_note_date_id", "notes")
