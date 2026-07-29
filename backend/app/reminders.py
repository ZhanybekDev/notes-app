"""Reminder scheduling and delivery bookkeeping.

The outbox table is the single source of truth for "already sent". Everything here is pure
domain logic over a Session so it can be unit-tested without a worker process — pytest measures
`--cov=app`, so logic parked in `scripts/` would escape the coverage gate entirely.
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import Note, Reminder, User

# How far back a reminder may still fire. Without this, the first run after a long downtime
# would flush every past-dated note at once.
BACKFILL_WINDOW = timedelta(hours=24)
# How far ahead rows are created. Bounded so the table does not mirror the whole notes table.
MATERIALIZE_HORIZON = timedelta(hours=48)
MAX_ATTEMPTS = 5
EXCERPT_LIMIT = 300
# Reconciliation passes run every 30s; bound them so a growing outbox cannot turn each pass into a
# full-table scan. Whatever a pass does not reach is picked up by the next one.
RECONCILE_LIMIT = 500
# Widest legitimate span of UTC offsets (UTC-12 … UTC+14). A pending row can be pushed this far
# past the horizon by a timezone change, and it still has to stay visible to the passes that
# maintain it — otherwise it freezes at a schedule nobody will ever correct again.
MAX_UTC_OFFSET_SPAN = timedelta(hours=26)

logger = logging.getLogger(__name__)


def compute_scheduled_for(note_date: date, tz_name: str, reminder_time: time) -> datetime:
    """Combine a calendar date with a local time in the user's zone, then normalise to UTC."""
    local = datetime.combine(note_date, reminder_time, tzinfo=ZoneInfo(tz_name))
    return local.astimezone(UTC)


def _as_utc(value: datetime) -> datetime:
    # SQLite hands back naive datetimes even for timezone=True columns.
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _notes_needing_reminders(db: Session, now: datetime) -> list[tuple[Note, User]]:
    """Notes that still need a reminder row created or revived.

    The `NOT EXISTS` is what makes the limit safe. Filtering only by date and then capping would
    starve the tail forever: already-materialised notes would occupy the first `RECONCILE_LIMIT`
    slots of every pass and the rest would never be reached. Excluding satisfied notes in SQL means
    the cap applies to outstanding work only.
    """
    # Bound the scan by calendar date with a day of slack on each side: the exact instant depends
    # on the user's zone, which can shift the boundary either way.
    earliest = (now - BACKFILL_WINDOW).date() - timedelta(days=1)
    latest = (now + MATERIALIZE_HORIZON).date() + timedelta(days=1)
    already_handled = (
        select(Reminder.id)
        .where(
            Reminder.note_id == Note.id,
            Reminder.note_date == Note.note_date,
            Reminder.status != Reminder.STATUS_CANCELLED,
        )
        .exists()
    )
    return (
        db.query(Note, User)
        .join(User, Note.user_id == User.id)
        .filter(
            Note.note_date.is_not(None),
            Note.note_date >= earliest,
            Note.note_date <= latest,
            Note.archived_at.is_(None),
            User.notifications_enabled.is_(True),
            User.telegram_chat_id.is_not(None),
            ~already_handled,
        )
        .order_by(Note.note_date, Note.id)
        .limit(RECONCILE_LIMIT)
        .all()
    )


def _in_range(scheduled_for: datetime, now: datetime) -> bool:
    return now - BACKFILL_WINDOW <= scheduled_for <= now + MATERIALIZE_HORIZON


def materialize_due(db: Session, now: datetime) -> int:
    """Create missing reminder rows and revive previously cancelled ones.

    Reviving matters because a cancelled row keeps occupying `(note_id, note_date)`: without it,
    moving a note's date away and back would mean the reminder never fires again.

    Existing rows are fetched in one query and everything is committed once. Committing per note
    would expire every loaded object (`expire_on_commit` is on by default), so each following
    iteration would re-`SELECT` its note and user — measured at 79 queries for 20 notes.
    """
    candidates = _notes_needing_reminders(db, now)
    if not candidates:
        return 0

    revivable = {
        (row.note_id, row.note_date): row
        for row in db.query(Reminder)
        .filter(
            Reminder.note_id.in_([note.id for note, _ in candidates]),
            Reminder.status == Reminder.STATUS_CANCELLED,
        )
        .all()
    }

    revived = 0
    fresh: list[Reminder] = []
    for note, user in candidates:
        try:
            scheduled_for = compute_scheduled_for(note.note_date, user.timezone, user.reminder_time)
        except (ZoneInfoNotFoundError, ValueError):
            logger.exception("cannot schedule note %s for user %s", note.id, user.id)
            continue
        if not _in_range(scheduled_for, now):
            continue

        row = revivable.get((note.id, note.note_date))
        if row is not None:
            row.status = Reminder.STATUS_PENDING
            row.scheduled_for = scheduled_for
            row.attempts = 0
            row.last_error = None
            revived += 1
            continue

        fresh.append(
            Reminder(
                user_id=user.id,
                note_id=note.id,
                note_date=note.note_date,
                scheduled_for=scheduled_for,
                status=Reminder.STATUS_PENDING,
            )
        )

    # Revivals update existing rows and cannot violate the uniqueness constraint, so they are
    # committed on their own. Folding them into the insert batch would let one losing insert roll
    # back work that was never in conflict.
    if revived:
        db.commit()
    if not fresh:
        return revived

    db.add_all(fresh)
    try:
        db.commit()
    except IntegrityError:
        # Safety net for a concurrent producer — normally only a manual tick() alongside the
        # service. The unique constraint is authoritative; the next pass picks the work up.
        db.rollback()
        logger.warning("materialisation lost a race on %s rows, retrying next pass", len(fresh))
        return revived
    return revived + len(fresh)


def resync_pending(db: Session, now: datetime) -> int:
    """Re-point pending rows at the user's current timezone and reminder time."""
    updated = 0
    rows = (
        db.query(Reminder, User)
        .join(User, Reminder.user_id == User.id)
        .filter(
            Reminder.status == Reminder.STATUS_PENDING,
            Reminder.scheduled_for <= now + MATERIALIZE_HORIZON + MAX_UTC_OFFSET_SPAN,
        )
        .order_by(Reminder.scheduled_for)
        .limit(RECONCILE_LIMIT)
        .all()
    )
    for reminder, user in rows:
        try:
            scheduled_for = compute_scheduled_for(
                reminder.note_date, user.timezone, user.reminder_time
            )
        except (ZoneInfoNotFoundError, ValueError):
            logger.exception("cannot reschedule reminder %s", reminder.id)
            continue
        if _as_utc(reminder.scheduled_for) != scheduled_for:
            reminder.scheduled_for = scheduled_for
            updated += 1
    if updated:
        db.commit()
    return updated


def still_deliverable(reminder: Reminder, note: Note | None, user: User | None) -> bool:
    """Every precondition that gated creation, re-checked at the moment of sending."""
    if note is None or user is None:
        return False
    return (
        note.archived_at is None
        and note.note_date is not None
        and note.note_date == reminder.note_date
        and user.notifications_enabled
        and user.telegram_chat_id is not None
    )


def cancel_stale(db: Session, now: datetime) -> int:
    """Cancel pending rows whose preconditions no longer hold.

    A row is created under one set of conditions and fires under another, so every condition that
    gated creation has to be re-checked before delivery.
    """
    cancelled = 0
    rows = (
        db.query(Reminder, Note, User)
        .join(Note, Reminder.note_id == Note.id)
        .join(User, Reminder.user_id == User.id)
        .filter(
            Reminder.status == Reminder.STATUS_PENDING,
            # Rows further out than the horizon cannot be due yet; overdue ones stay in scope
            # precisely because they are the ones that need cancelling.
            Reminder.scheduled_for <= now + MATERIALIZE_HORIZON + MAX_UTC_OFFSET_SPAN,
        )
        .order_by(Reminder.scheduled_for)
        .limit(RECONCILE_LIMIT)
        .all()
    )
    for reminder, note, user in rows:
        stale = (
            not still_deliverable(reminder, note, user)
            or _as_utc(reminder.scheduled_for) < now - BACKFILL_WINDOW
        )
        if stale:
            reminder.status = Reminder.STATUS_CANCELLED
            cancelled += 1
    if cancelled:
        db.commit()
    return cancelled


def claim_next(db: Session, now: datetime, exclude: set[int]) -> Reminder | None:
    """Lock the next due reminder, skipping ones another sender already holds.

    Claims one row rather than a batch so the lock actually covers the whole send: the first
    `mark_sent`/`mark_failed` commit ends the transaction, which with a batch would release the
    lock on every row still waiting its turn. `exclude` holds the rows already attempted in this
    pass, so a row that stayed pending after a failure is not picked up again immediately.

    SKIP LOCKED is a no-op on SQLite and exclusive on Postgres.
    """
    stmt = (
        select(Reminder)
        .where(
            Reminder.status == Reminder.STATUS_PENDING,
            Reminder.scheduled_for <= now,
            Reminder.id.not_in(exclude),
        )
        .order_by(Reminder.scheduled_for)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    return db.execute(stmt).scalars().first()


def mark_sent(db: Session, reminder: Reminder, now: datetime) -> None:
    reminder.status = Reminder.STATUS_SENT
    reminder.sent_at = now
    reminder.attempts += 1
    reminder.last_error = None
    db.commit()


def mark_failed(db: Session, reminder: Reminder, error: str) -> None:
    reminder.attempts += 1
    reminder.last_error = error[:500]
    if reminder.attempts >= MAX_ATTEMPTS:
        reminder.status = Reminder.STATUS_FAILED
    db.commit()


def render_message(note: Note) -> str:
    """Plain text only — the app stores Markdown, which no parse_mode would survive."""
    excerpt = " ".join((note.content or "").split())
    if len(excerpt) > EXCERPT_LIMIT:
        excerpt = excerpt[:EXCERPT_LIMIT].rstrip() + "…"
    lines = [f"⏰ {note.title}", f"Date: {note.note_date.isoformat()}"]
    if excerpt:
        lines.append("")
        lines.append(excerpt)
    return "\n".join(lines)
