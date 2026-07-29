"""Reminder scheduling and delivery bookkeeping.

The outbox table is the single source of truth for "already sent". Everything here is pure
domain logic over a Session so it can be unit-tested without a worker process — pytest measures
`--cov=app`, so logic parked in `scripts/` would escape the coverage gate entirely.
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

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

logger = logging.getLogger(__name__)


def compute_scheduled_for(note_date: date, tz_name: str, reminder_time: time) -> datetime:
    """Combine a calendar date with a local time in the user's zone, then normalise to UTC."""
    local = datetime.combine(note_date, reminder_time, tzinfo=ZoneInfo(tz_name))
    return local.astimezone(UTC)


def _as_utc(value: datetime) -> datetime:
    # SQLite hands back naive datetimes even for timezone=True columns.
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _eligible_notes(db: Session, now: datetime) -> list[tuple[Note, User]]:
    # Bound the scan by calendar date with a day of slack on each side: the exact instant depends
    # on the user's zone, which can shift the boundary either way.
    earliest = (now - BACKFILL_WINDOW).date() - timedelta(days=1)
    latest = (now + MATERIALIZE_HORIZON).date() + timedelta(days=1)
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
        )
        .all()
    )


def _in_range(scheduled_for: datetime, now: datetime) -> bool:
    return now - BACKFILL_WINDOW <= scheduled_for <= now + MATERIALIZE_HORIZON


def materialize_due(db: Session, now: datetime) -> int:
    """Create missing reminder rows and revive previously cancelled ones.

    Reviving matters because a cancelled row keeps occupying `(note_id, note_date)`: without it,
    moving a note's date away and back would mean the reminder never fires again.
    """
    created = 0
    for note, user in _eligible_notes(db, now):
        try:
            scheduled_for = compute_scheduled_for(note.note_date, user.timezone, user.reminder_time)
        except Exception:
            logger.exception("cannot schedule note %s for user %s", note.id, user.id)
            continue
        if not _in_range(scheduled_for, now):
            continue

        existing = (
            db.query(Reminder)
            .filter(Reminder.note_id == note.id, Reminder.note_date == note.note_date)
            .one_or_none()
        )
        if existing is not None:
            if existing.status == Reminder.STATUS_CANCELLED:
                existing.status = Reminder.STATUS_PENDING
                existing.scheduled_for = scheduled_for
                existing.attempts = 0
                existing.last_error = None
                db.commit()
                created += 1
            continue

        db.add(
            Reminder(
                user_id=user.id,
                note_id=note.id,
                note_date=note.note_date,
                scheduled_for=scheduled_for,
                status=Reminder.STATUS_PENDING,
            )
        )
        try:
            db.commit()
            created += 1
        except IntegrityError:
            # Safety net for a concurrent producer; the unique constraint is authoritative.
            db.rollback()
    return created


def resync_pending(db: Session, now: datetime) -> int:
    """Re-point pending rows at the user's current timezone and reminder time."""
    updated = 0
    rows = (
        db.query(Reminder, User)
        .join(User, Reminder.user_id == User.id)
        .filter(Reminder.status == Reminder.STATUS_PENDING)
        .all()
    )
    for reminder, user in rows:
        try:
            scheduled_for = compute_scheduled_for(
                reminder.note_date, user.timezone, user.reminder_time
            )
        except Exception:
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
        .filter(Reminder.status == Reminder.STATUS_PENDING)
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


def claim_batch(db: Session, now: datetime, limit: int = 50) -> list[Reminder]:
    """Lock the reminders that are due. SKIP LOCKED is a no-op on SQLite, exclusive on Postgres."""
    stmt = (
        select(Reminder)
        .where(Reminder.status == Reminder.STATUS_PENDING, Reminder.scheduled_for <= now)
        .order_by(Reminder.scheduled_for)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    return list(db.execute(stmt).scalars().all())


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
