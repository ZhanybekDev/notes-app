from __future__ import annotations

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import or_
from sqlalchemy.orm import Session

from .models import Note, User


def now_utc() -> datetime:
    return datetime.now(UTC)


def today_in_timezone(timezone_name: str, now: datetime | None = None) -> date:
    reference = now or now_utc()
    return reference.astimezone(ZoneInfo(timezone_name)).date()


def list_due_notes(
    db: Session,
    *,
    today: date,
) -> list[Note]:
    return (
        db.query(Note)
        .join(User, User.id == Note.user_id)
        .filter(
            Note.archived_at.is_(None),
            Note.note_date.is_not(None),
            Note.note_date <= today,
            User.telegram_chat_id.is_not(None),
            User.telegram_notifications_enabled.is_(True),
            or_(
                Note.reminder_sent_for_date.is_(None),
                Note.reminder_sent_for_date != Note.note_date,
            ),
        )
        .order_by(Note.note_date.asc(), Note.id.asc())
        .all()
    )


def render_reminder_message(note: Note) -> str:
    lines = [f"Reminder: {note.title}"]
    if note.note_date is not None:
        lines.append(f"Date: {note.note_date.isoformat()}")

    preview = " ".join((note.content or "").split())
    if preview:
        lines.append("")
        lines.append(preview[:280])

    return "\n".join(lines)


def send_due_reminders_once(
    db: Session,
    bot,
    *,
    reminder_timezone: str,
    now: datetime | None = None,
) -> int:
    sent_count = 0
    sent_at = now or now_utc()
    today = today_in_timezone(reminder_timezone, sent_at)

    for note in list_due_notes(db, today=today):
        chat_id = note.owner.telegram_chat_id
        if not chat_id:
            continue
        try:
            bot.send_message(chat_id, render_reminder_message(note))
        except Exception:
            db.rollback()
            continue

        note.reminder_sent_at = sent_at
        note.reminder_sent_for_date = note.note_date
        db.commit()
        db.refresh(note)
        sent_count += 1

    return sent_count
