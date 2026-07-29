"""Reminder scheduling and delivery bookkeeping.

The outbox table is the single source of truth for "already sent". Everything here is pure
domain logic over a Session so it can be unit-tested without a worker process — pytest measures
`--cov=app`, so logic parked in `scripts/` would escape the coverage gate entirely.
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import and_, or_, select
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
# Real-world bounds on UTC offsets: UTC-12 … UTC+14.
MAX_UTC_OFFSET_EAST = timedelta(hours=14)
MAX_UTC_OFFSET_WEST = timedelta(hours=12)
# A pending row can be pushed this far past the horizon by a timezone change, and it still has to
# stay visible to the passes that maintain it — otherwise it freezes at a schedule nobody will
# ever correct again.
MAX_UTC_OFFSET_SPAN = MAX_UTC_OFFSET_EAST + MAX_UTC_OFFSET_WEST

logger = logging.getLogger(__name__)


def compute_scheduled_for(note_date: date, tz_name: str, reminder_time: time) -> datetime:
    """Combine a calendar date with a local time in the user's zone, then normalise to UTC."""
    local = datetime.combine(note_date, reminder_time, tzinfo=ZoneInfo(tz_name))
    return local.astimezone(UTC)


def _as_utc(value: datetime) -> datetime:
    # SQLite hands back naive datetimes even for timezone=True columns.
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _candidate_date_range(now: datetime) -> tuple[date, date]:
    """Widest range of `note_date` values that could possibly land inside the delivery window.

    A note's instant is `note_date + reminder_time - utc_offset`, with `reminder_time` anywhere in
    the day and the offset between -12h and +14h, so the instant sits somewhere in
    `[note_date - 14h, note_date + 36h]`. Intersecting that with the delivery window gives these
    bounds.

    Derived rather than guessed at, because the previous flat day of slack was only accidentally
    right: sufficient at the bottom, a day too generous at the top. Both ends err on the side of
    including dates that `_in_range` will reject — truncating to a date can only widen the range —
    and that is the safe direction, since the cost of an extra candidate is one rejected row in a
    sweep, while the cost of a missing one is a reminder that never fires.
    """
    earliest = now - BACKFILL_WINDOW - timedelta(days=1) - MAX_UTC_OFFSET_WEST
    latest = now + MATERIALIZE_HORIZON + MAX_UTC_OFFSET_EAST
    return earliest.date(), latest.date()


def _notes_needing_reminders(
    db: Session, now: datetime, after: tuple[date, int] | None
) -> list[tuple[Note, User]]:
    """Notes that still need a reminder row created or revived, starting after `after`.

    Two mechanisms keep the capped pass honest:

    `NOT EXISTS` drops notes that already have a live row, so the cap applies to outstanding work
    rather than to everything in the date window.

    `after` sweeps. The date range has to be wider than the delivery window — SQL cannot evaluate
    a user's timezone — so some candidates are rejected by `_in_range` on every pass and never
    produce a row. Sorted by date they cluster at the start, and with a fixed cap they would keep
    the pass from ever reaching notes that are genuinely due. Resuming past the last examined note
    means a few passes sweep the whole window instead of re-reading the same dead prefix.
    """
    earliest, latest = _candidate_date_range(now)
    already_handled = (
        select(Reminder.id)
        .where(
            Reminder.note_id == Note.id,
            Reminder.note_date == Note.note_date,
            Reminder.status != Reminder.STATUS_CANCELLED,
        )
        .exists()
    )
    query = (
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
    )
    if after is not None:
        last_date, last_id = after
        # Spelled out rather than as a row-value comparison: portable across both dialects.
        query = query.filter(
            or_(
                Note.note_date > last_date,
                and_(Note.note_date == last_date, Note.id > last_id),
            )
        )
    return query.order_by(Note.note_date, Note.id).limit(RECONCILE_LIMIT).all()


def _in_range(scheduled_for: datetime, now: datetime) -> bool:
    return now - BACKFILL_WINDOW <= scheduled_for <= now + MATERIALIZE_HORIZON


def materialize_due(
    db: Session, now: datetime, after: tuple[date, int] | None = None
) -> tuple[int, tuple[date, int] | None]:
    """Create missing reminder rows and revive previously cancelled ones.

    Reviving matters because a cancelled row keeps occupying `(note_id, note_date)`: without it,
    moving a note's date away and back would mean the reminder never fires again.

    Returns the number of rows touched and where to resume. A cursor comes back only when the pass
    filled its quota; `None` means the window is exhausted and the next pass starts over.

    Existing rows are fetched in one query, and the pass commits at most twice — once for revivals
    and once for inserts, kept apart so a losing insert cannot roll back a revival that was never
    in conflict. Committing per note instead would expire every loaded object (`expire_on_commit`
    is on by default), and each following iteration would re-`SELECT` its note and user — measured
    at 79 queries for 20 notes.
    """
    candidates = _notes_needing_reminders(db, now, after)
    if not candidates:
        return 0, None
    exhausted = len(candidates) < RECONCILE_LIMIT
    last_note = candidates[-1][0]
    next_after = None if exhausted else (last_note.note_date, last_note.id)

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
        return revived, next_after

    db.add_all(fresh)
    try:
        db.commit()
    except IntegrityError:
        # Safety net for a concurrent producer — normally only a manual tick() alongside the
        # service. The unique constraint is authoritative; the next pass picks the work up.
        db.rollback()
        logger.warning("materialisation lost a race on %s rows, retrying next pass", len(fresh))
        return revived, next_after
    return revived + len(fresh), next_after


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
