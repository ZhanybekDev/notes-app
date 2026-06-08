from __future__ import annotations

import argparse
import logging
import time
from collections.abc import Callable
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from .config import settings
from .db import SessionLocal
from .models import User
from .reminders import now_utc, send_due_reminders_once
from .telegram_bot import TelegramBotClient

logger = logging.getLogger(__name__)

_LINKED_MESSAGE = "Telegram connected. Date reminders are now enabled."
_INVALID_CODE_MESSAGE = "Link code is invalid or expired. Generate a new one in Settings."
_ALREADY_LINKED_MESSAGE = "This Telegram account is already linked to another Notes account."


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _parse_start_code(text: str | None) -> str | None:
    if not text:
        return None
    parts = text.strip().split(maxsplit=1)
    if not parts:
        return None
    command = parts[0].split("@", 1)[0]
    if command != "/start" or len(parts) != 2:
        return None
    code = parts[1].strip().upper()
    return code or None


def link_telegram_account(
    db: Session,
    bot: TelegramBotClient,
    *,
    chat_id: str,
    telegram_username: str | None,
    code: str,
    now: datetime | None = None,
) -> bool:
    current_time = _as_utc(now or now_utc())
    user = db.query(User).filter(User.telegram_link_code == code).one_or_none()
    if user is None:
        bot.send_message(chat_id, _INVALID_CODE_MESSAGE)
        return False

    existing_owner = (
        db.query(User).filter(User.telegram_chat_id == chat_id, User.id != user.id).one_or_none()
    )
    if existing_owner is not None:
        bot.send_message(chat_id, _ALREADY_LINKED_MESSAGE)
        return False

    expires_at = user.telegram_link_code_expires_at
    if expires_at is None or _as_utc(expires_at) < current_time:
        user.telegram_link_code = None
        user.telegram_link_code_expires_at = None
        db.commit()
        bot.send_message(chat_id, _INVALID_CODE_MESSAGE)
        return False

    user.telegram_chat_id = chat_id
    user.telegram_username = telegram_username
    user.telegram_notifications_enabled = True
    user.telegram_link_code = None
    user.telegram_link_code_expires_at = None
    db.commit()
    bot.send_message(chat_id, _LINKED_MESSAGE)
    return True


def process_update(
    db: Session,
    bot: TelegramBotClient,
    update: dict,
    *,
    now: datetime | None = None,
) -> bool:
    message = update.get("message")
    if not isinstance(message, dict):
        return False

    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    if chat_id is None:
        return False

    code = _parse_start_code(message.get("text"))
    if code is None:
        return False

    sender = message.get("from") or {}
    username = sender.get("username")
    if username is not None:
        username = str(username)

    return link_telegram_account(
        db,
        bot,
        chat_id=str(chat_id),
        telegram_username=username,
        code=code,
        now=now,
    )


def process_updates(
    db: Session,
    bot: TelegramBotClient,
    updates: list[dict],
    *,
    now: datetime | None = None,
) -> int:
    handled = 0
    for update in updates:
        handled += int(process_update(db, bot, update, now=now))
    return handled


def send_due_once(
    *,
    session_factory: Callable[[], Session] = SessionLocal,
    bot: TelegramBotClient | None = None,
    now: datetime | None = None,
) -> int:
    current_bot = bot or TelegramBotClient(
        settings.telegram_bot_token,
        timeout_seconds=settings.telegram_poll_timeout_seconds,
    )
    try:
        if not current_bot.enabled:
            logger.info("Telegram bot token is missing; reminder send skipped")
            return 0
        db = session_factory()
        try:
            sent = send_due_reminders_once(
                db,
                current_bot,
                reminder_timezone=settings.reminder_timezone,
                now=now,
            )
            logger.info("Processed due reminders", extra={"sent": sent})
            return sent
        finally:
            db.close()
    finally:
        if bot is None:
            current_bot.close()


def run(
    *,
    session_factory: Callable[[], Session] = SessionLocal,
    bot: TelegramBotClient | None = None,
) -> None:
    current_bot = bot or TelegramBotClient(
        settings.telegram_bot_token,
        timeout_seconds=settings.telegram_poll_timeout_seconds,
    )
    try:
        if not current_bot.enabled:
            logger.info("Telegram bot token is missing; worker is running in disabled mode")
            while True:
                time.sleep(max(settings.reminder_poll_interval_seconds, 30))

        next_reminder_check = 0.0
        offset: int | None = None
        while True:
            updates = current_bot.get_updates(
                offset=offset,
                timeout=settings.telegram_poll_timeout_seconds,
            )
            if updates:
                db = session_factory()
                try:
                    process_updates(db, current_bot, updates)
                finally:
                    db.close()
                offset = (
                    max(int(update["update_id"]) for update in updates if "update_id" in update) + 1
                )

            now_monotonic = time.monotonic()
            if now_monotonic >= next_reminder_check:
                send_due_once(session_factory=session_factory, bot=current_bot)
                next_reminder_check = now_monotonic + settings.reminder_poll_interval_seconds
    finally:
        if bot is None:
            current_bot.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

    parser = argparse.ArgumentParser(description="Telegram bot worker for note reminders")
    parser.add_argument("command", choices=["run", "send-due-once"])
    args = parser.parse_args()

    if args.command == "send-due-once":
        send_due_once()
        return
    run()


if __name__ == "__main__":
    main()
