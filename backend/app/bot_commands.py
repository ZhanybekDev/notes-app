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


class BadTimezone(Exception):
    """The account's timezone string does not name a real zone."""


def _zone(name: str) -> ZoneInfo:
    """Resolve a zone name, collapsing both ways it can fail into one.

    `ZoneInfo` raises `ZoneInfoNotFoundError` for an unknown key and `ValueError` for a malformed
    one — empty, absolute, or not normalised. Catching only the first let the second escape into
    the polling loop, which catches neither, killing the worker for every user over one bad row.
    Narrowing to this call keeps the guard from swallowing an unrelated `ValueError` further out.
    """
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise BadTimezone(name) from exc


def _parse(text: str) -> tuple[str | None, str | None]:
    """Split `/command@bot argument` into its command and its argument."""
    parts = text.strip().split(maxsplit=1)
    if not parts or not parts[0].startswith("/"):
        return None, None
    command = parts[0].split("@")[0].lstrip("/").lower()
    argument = parts[1].strip() if len(parts) > 1 and parts[1].strip() else None
    return command, argument


def _help(language: str, *, linked: bool) -> str:
    lines = [t(language, "help_intro"), ""]
    lines += [f"/{name} — {t(language, key)}" for name, key in COMMANDS]
    if not linked:
        # The menu button reaches this list without ever passing through the deep link, so an
        # unbound chat is told what to do here rather than after failing every command in it.
        lines += ["", t(language, "start_without_code")]
    return "\n".join(lines)


def _start(
    db: Session,
    chat_id: int,
    code: str | None,
    language: str,
    username: str | None,
    *,
    user: User | None,
) -> str:
    if code is None:
        # Telegram sends a bare /start from the START button in every fresh chat view, so an
        # already-bound chat must not be sent off to generate a code it does not need.
        return _help(language, linked=user is not None)
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
    return now.astimezone(_zone(user.timezone)).date()


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


def _reminder_state(user: User, language: str) -> str:
    """What will actually happen, not just what the flag says.

    `reminders.materialize_due` skips any user whose zone will not resolve and logs it, so for
    those accounts no row is ever created and nothing ever fires. Reporting "Reminders: on" there
    would be a plain untruth from the one command whose job is to say how the chat stands.
    """
    if not user.notifications_enabled:
        return t(language, "status_off")
    try:
        _zone(user.timezone)
    except BadTimezone:
        return t(language, "status_zone_broken", zone=user.timezone)
    return t(language, "status_on")


def _status(user: User, language: str) -> str:
    lines = [
        t(language, "status_linked", username=user.telegram_username)
        if user.telegram_username
        else t(language, "status_linked_no_username"),
        t(language, "status_timezone", zone=user.timezone),
        t(language, "status_time", time=user.reminder_time.strftime("%H:%M")),
        _reminder_state(user, language),
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
    user = telegram_link.user_for_chat(db, chat_id)

    if command == "start":
        return BotReply(
            chat_id, _start(db, chat_id, argument, language, sender.get("username"), user=user)
        )

    if user is not None and user.telegram_language != language:
        # Telegram reports the client language on every update, but it used to be stored only at
        # link time, so a user who switched languages afterwards got answers in the new one and
        # reminders in the old one until they unlinked and relinked.
        user.telegram_language = language
        db.commit()

    if command not in _COMMAND_NAMES or command == "help":
        return BotReply(chat_id, _help(language, linked=user is not None))
    if user is None:
        return BotReply(chat_id, t(language, "start_without_code"))

    try:
        if command == "today":
            return BotReply(chat_id, _today(db, user, language, now))
        if command == "upcoming":
            return BotReply(chat_id, _upcoming(db, user, language, now))
    except BadTimezone:
        # Only reachable if the column was edited outside the API, which validates it. Saying so
        # beats letting it escape into the polling loop, which does not catch this.
        return BotReply(chat_id, t(language, "bad_timezone", zone=user.timezone))

    if command == "status":
        return BotReply(chat_id, _status(user, language))
    if command == "pause":
        return BotReply(chat_id, _switch(db, user, language, on=False))
    if command == "resume":
        return BotReply(chat_id, _switch(db, user, language, on=True))

    # Unreachable while every name in COMMANDS has a branch above. It used to be a bare fall-through
    # to /resume, which would have silently un-paused an account the day a seventh command was
    # advertised — COMMANDS feeds setMyCommands and /help, so the menu would offer it immediately.
    logger.error("advertised command /%s has no handler", command)
    return BotReply(chat_id, _help(language, linked=True))
