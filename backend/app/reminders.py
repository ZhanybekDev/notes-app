"""Reminder selection, delivery and Telegram account linking.

Kept free of FastAPI and network concerns so it can be unit-tested with a fake
``sender`` and an in-memory session. The worker process wires the real Telegram
client into these functions.
"""

from __future__ import annotations

import logging
import secrets
import time
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import Note, ReminderSent, User

log = logging.getLogger("reminders")

# A delivery sink: (chat_id, text) -> None. Raises on failure so we can retry.
Sender = Callable[[str, str], object]

LINK_CODE_TTL = timedelta(minutes=15)


def safe_zone(tz_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def user_today(tz_name: str, now_utc: datetime) -> date:
    """The calendar date *as the user sees it* in their timezone."""
    return now_utc.astimezone(safe_zone(tz_name)).date()


def format_message(note: Note) -> str:
    lines = [f"Reminder: {note.title}", f"Date: {note.note_date.isoformat()}"]
    body = (note.content or "").strip()
    if body:
        preview = body if len(body) <= 280 else body[:277] + "..."
        lines += ["", preview]
    return "\n".join(lines)


def due_reminders(db: Session, now_utc: datetime) -> list[tuple[User, Note]]:
    """Notes whose date has arrived (in the owner's tz) and not yet reminded."""
    users = (
        db.query(User)
        .filter(User.telegram_enabled.is_(True), User.telegram_chat_id.is_not(None))
        .all()
    )
    out: list[tuple[User, Note]] = []
    for user in users:
        today = user_today(user.timezone, now_utc)
        notes = (
            db.query(Note)
            .filter(
                Note.user_id == user.id,
                Note.note_date.is_not(None),
                Note.note_date <= today,
                Note.archived_at.is_(None),
            )
            .order_by(Note.note_date.asc(), Note.id.asc())
            .all()
        )
        for note in notes:
            already = (
                db.query(ReminderSent)
                .filter(
                    ReminderSent.note_id == note.id,
                    ReminderSent.note_date == note.note_date,
                )
                .first()
            )
            if already is None:
                out.append((user, note))
    return out


def _deliver(
    sender: Sender, chat_id: str, text: str, attempts: int, sleep: Callable[[float], object]
) -> bool:
    """Send with bounded exponential backoff. Returns True on first success."""
    for i in range(attempts):
        try:
            sender(chat_id, text)
            return True
        except Exception as exc:  # noqa: BLE001 - any send failure is retryable
            log.warning("telegram send failed (attempt %d/%d): %s", i + 1, attempts, exc)
            if i < attempts - 1:
                sleep(min(2**i, 5))
    return False


def process_due(
    db: Session,
    sender: Sender,
    *,
    now_utc: datetime | None = None,
    attempts: int = 3,
    sleep: Callable[[float], object] = time.sleep,
) -> int:
    """Deliver all due reminders. Returns the count actually sent.

    Claim-first idempotency: we insert the ``reminders_sent`` row and commit *before*
    sending, so the ``UNIQUE(note_id, note_date)`` constraint gates the *delivery*, not
    just the bookkeeping. A concurrent tick or a second worker that loses the insert
    race gets ``IntegrityError`` and skips - so a message is never sent twice. If the
    send then fails every attempt we delete the claim, releasing the note for the next
    tick. The remaining gap is at-most-once: a crash between a successful send and the
    delete-on-failure path can only ever drop a reminder, never duplicate it.
    """
    now_utc = now_utc or datetime.now(UTC)
    sent = 0
    for user, note in due_reminders(db, now_utc):
        claim = ReminderSent(note_id=note.id, note_date=note.note_date)
        db.add(claim)
        try:
            db.commit()  # claim the (note, date) - UNIQUE blocks a concurrent double-send
        except IntegrityError:
            db.rollback()
            continue
        if _deliver(sender, user.telegram_chat_id, format_message(note), attempts, sleep):
            sent += 1
        else:
            db.delete(claim)  # send failed - release the claim so it retries next tick
            db.commit()
    return sent


# --- Telegram account linking -------------------------------------------------


def issue_link_code(db: Session, user: User, *, now_utc: datetime | None = None) -> str:
    """Generate a short-lived one-time code the user sends to the bot as /start."""
    now_utc = now_utc or datetime.now(UTC)
    code = secrets.token_urlsafe(8)
    user.telegram_link_code = code
    user.telegram_link_code_expires_at = now_utc + LINK_CODE_TTL
    db.commit()
    return code


def resolve_link_code(
    db: Session, code: str, chat_id: str, *, now_utc: datetime | None = None
) -> User | None:
    """Bind a Telegram chat to the user owning ``code``. Returns the user or None.

    On success the chat id is stored, reminders are enabled, and the code is
    cleared so it cannot be reused.
    """
    now_utc = now_utc or datetime.now(UTC)
    user = db.query(User).filter(User.telegram_link_code == code).first()
    if user is None:
        return None
    expires = user.telegram_link_code_expires_at
    if expires is not None:
        if expires.tzinfo is None:  # SQLite drops tz info on round-trip
            expires = expires.replace(tzinfo=UTC)
        if expires < now_utc:
            return None
    user.telegram_chat_id = chat_id
    user.telegram_enabled = True
    user.telegram_link_code = None
    user.telegram_link_code_expires_at = None
    db.commit()
    return user


def parse_start_command(text: str) -> str | None:
    """Extract the code from a "/start <code>" message, else None."""
    parts = (text or "").strip().split(maxsplit=1)
    if len(parts) == 2 and parts[0] == "/start":
        return parts[1].strip() or None
    return None
