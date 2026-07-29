"""Everything the bot says, and the routing that decides which of it to say.

The single entry point for an incoming update. `telegram_link` owns the account work and returns a
result; the wording lives here, so there is one place to look for what a user will read.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from . import telegram_link
from .bot_i18n import resolve_language, t
from .models import Note, User
from .telegram_link import LinkResult

logger = logging.getLogger(__name__)

# Advertised through setMyCommands and listed by /help, so the menu and the help cannot disagree.
# `/start` is deliberately absent: it arrives through a deep link, not from the menu.
COMMANDS: tuple[tuple[str, str], ...] = (
    ("today", "cmd_today"),
    ("upcoming", "cmd_upcoming"),
    ("status", "cmd_status"),
    ("pause", "cmd_pause"),
    ("resume", "cmd_resume"),
    ("help", "cmd_help"),
)
_COMMAND_NAMES = frozenset(name for name, _ in COMMANDS)

MAX_LIST_ITEMS = 10
MAX_TITLE_CHARS = 80
UPCOMING_DAYS = 7


@dataclass(frozen=True)
class BotReply:
    chat_id: int
    text: str


def _parse(text: str) -> tuple[str | None, str | None]:
    """Split `/command@bot argument` into its command and its argument."""
    parts = text.strip().split(maxsplit=1)
    if not parts or not parts[0].startswith("/"):
        return None, None
    command = parts[0].split("@")[0].lstrip("/").lower()
    argument = parts[1].strip() if len(parts) > 1 and parts[1].strip() else None
    return command, argument


def _help(language: str) -> str:
    lines = [t(language, "help_intro"), ""]
    lines += [f"/{name} — {t(language, key)}" for name, key in COMMANDS]
    return "\n".join(lines)


def _start(db: Session, chat_id: int, code: str | None, language: str, username: str | None) -> str:
    if code is None:
        return t(language, "start_without_code")
    result, user = telegram_link.redeem_code(
        db, code=code, chat_id=chat_id, telegram_username=username, language=language
    )
    if result is LinkResult.UNKNOWN_OR_EXPIRED:
        return t(language, "link_unknown")
    if result is LinkResult.CHAT_TAKEN:
        return t(language, "link_taken")
    logger.info("linked chat %s", chat_id)
    return t(language, "linked", username=user.username)


def _today_for(user: User, now: datetime) -> date:
    """Today from the account's point of view, which is the only one that matters here."""
    return now.astimezone(ZoneInfo(user.timezone)).date()


def _titles(db: Session, user: User, first: date, last: date) -> tuple[list[Note], int]:
    query = (
        db.query(Note)
        .filter(
            Note.user_id == user.id,
            Note.archived_at.is_(None),
            Note.note_date.is_not(None),
            Note.note_date >= first,
            Note.note_date <= last,
        )
        .order_by(Note.note_date, Note.id)
    )
    return query.limit(MAX_LIST_ITEMS).all(), query.count()


def _cut(title: str) -> str:
    return title if len(title) <= MAX_TITLE_CHARS else title[:MAX_TITLE_CHARS] + "…"


def _render(language: str, header: str, notes: list[Note], total: int, *, dated: bool) -> str:
    lines = [header, ""]
    for note in notes:
        lines.append(
            t(language, "list_item_dated", date=note.note_date.isoformat(), title=_cut(note.title))
            if dated
            else t(language, "list_item", title=_cut(note.title))
        )
    if total > len(notes):
        lines.append(t(language, "list_more", count=total - len(notes)))
    return "\n".join(lines)


def _today(db: Session, user: User, language: str, now: datetime) -> str:
    day = _today_for(user, now)
    notes, total = _titles(db, user, day, day)
    if not notes:
        return t(language, "today_empty")
    return _render(
        language, t(language, "today_header", date=day.isoformat()), notes, total, dated=False
    )


def _upcoming(db: Session, user: User, language: str, now: datetime) -> str:
    day = _today_for(user, now)
    notes, total = _titles(db, user, day + timedelta(days=1), day + timedelta(days=UPCOMING_DAYS))
    if not notes:
        return t(language, "upcoming_empty")
    return _render(language, t(language, "upcoming_header"), notes, total, dated=True)


def _status(user: User, language: str) -> str:
    lines = [
        t(language, "status_linked", username=user.telegram_username)
        if user.telegram_username
        else t(language, "status_linked_no_username"),
        t(language, "status_timezone", zone=user.timezone),
        t(language, "status_time", time=user.reminder_time.strftime("%H:%M")),
        t(language, "status_on" if user.notifications_enabled else "status_off"),
    ]
    return "\n".join(lines)


def _switch(db: Session, user: User, language: str, *, on: bool) -> str:
    """Idempotent on purpose: nothing useful distinguishes pausing an already-silent account."""
    user.notifications_enabled = on
    db.commit()
    return t(language, "resumed" if on else "paused")


def handle_update(
    db: Session, update: dict[str, Any], now: datetime | None = None
) -> BotReply | None:
    """Answer one update, or None when there is nothing to answer."""
    now = now or datetime.now(UTC)
    message = update.get("message") or {}
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    if not isinstance(chat_id, int):
        return None

    text = message.get("text")
    # Stickers, photos and forwards are left alone; answering each with a menu would be noise.
    if not isinstance(text, str) or not text.strip():
        return None

    sender = message.get("from") or {}
    language = resolve_language(sender.get("language_code"))
    command, argument = _parse(text)

    if command == "start":
        return BotReply(chat_id, _start(db, chat_id, argument, language, sender.get("username")))
    if command not in _COMMAND_NAMES or command == "help":
        return BotReply(chat_id, _help(language))

    user = telegram_link.user_for_chat(db, chat_id)
    if user is None:
        return BotReply(chat_id, t(language, "start_without_code"))

    try:
        if command == "today":
            return BotReply(chat_id, _today(db, user, language, now))
        if command == "upcoming":
            return BotReply(chat_id, _upcoming(db, user, language, now))
    except ZoneInfoNotFoundError:
        # Only reachable if the column was edited outside the API, which validates it. Saying so
        # beats letting it escape into the polling loop, which does not catch this.
        return BotReply(chat_id, t(language, "bad_timezone", zone=user.timezone))

    if command == "status":
        return BotReply(chat_id, _status(user, language))
    if command == "pause":
        return BotReply(chat_id, _switch(db, user, language, on=False))
    return BotReply(chat_id, _switch(db, user, language, on=True))
