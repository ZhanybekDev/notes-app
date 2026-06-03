"""Background worker: delivers due Telegram reminders and links accounts.

Runs as its own container (see docker-compose ``worker`` service) so it never
contends with uvicorn's ``--reload`` and there is exactly one ``getUpdates``
consumer. All real logic lives in ``app.reminders`` (unit-tested); this entry
point is thin glue.

Two responsibilities:
- APScheduler interval job → ``process_due`` every ``REMINDER_INTERVAL_SECONDS``.
- ``getUpdates`` long-poll loop → bind a chat to a user on ``/start <code>``.

With no ``TELEGRAM_BOT_TOKEN`` the worker logs and idles so the stack still runs.
"""

import logging
import time
from datetime import UTC, datetime

from apscheduler.schedulers.background import BackgroundScheduler

from app.config import settings
from app.db import SessionLocal
from app.reminders import parse_start_command, process_due, resolve_link_code
from app.telegram import TelegramClient, TelegramError, get_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("worker")


def run_reminders() -> None:
    client = get_client()
    if client is None:
        return
    db = SessionLocal()
    try:
        count = process_due(db, client.send_message)
        if count:
            log.info("sent %d reminder(s)", count)
    except Exception:  # noqa: BLE001 - never let a bad tick kill the scheduler
        log.exception("reminder tick failed")
    finally:
        db.close()


def handle_update(update: dict, client: TelegramClient) -> None:
    """Process one update. Swallows its own errors so the poll loop can safely
    advance the offset afterwards (at-most-once: a failed update is logged, not
    retried, which avoids both a poison-pill loop and duplicate replies)."""
    try:
        message = update.get("message") or {}
        code = parse_start_command(message.get("text") or "")
        if not code:
            return
        chat_id = str((message.get("chat") or {}).get("id"))
        db = SessionLocal()
        try:
            user = resolve_link_code(db, code, chat_id)
        finally:
            db.close()
        reply = (
            "Linked. You will get a reminder here when a note's date arrives."
            if user
            else "This link code is invalid or expired. Generate a new one in Settings."
        )
        client.send_message(chat_id, reply)
    except Exception:  # noqa: BLE001 - never let one bad update break the loop
        log.exception("failed handling update %s", update.get("update_id"))


def poll_updates(client: TelegramClient) -> None:
    offset: int | None = None
    while True:
        try:
            updates = client.get_updates(offset=offset, timeout=30)
        except TelegramError as exc:
            log.warning("getUpdates failed: %s", exc)
            time.sleep(3)
            continue
        for update in updates:
            handle_update(update, client)
            offset = update["update_id"] + 1  # advance only after handling completes


def idle_forever(reason: str) -> None:
    log.warning("%s - reminder worker idle", reason)
    while True:
        time.sleep(3600)


def main() -> None:
    client = get_client()
    if client is None:
        return idle_forever("TELEGRAM_BOT_TOKEN not set")

    # Validate the token once at boot so a bad token fails loudly here instead of
    # spinning forever in the getUpdates retry loop with no reminders going out.
    try:
        me = client.get_me()
        log.info("authenticated as @%s", me.get("username"))
    except TelegramError as exc:
        return idle_forever(f"TELEGRAM_BOT_TOKEN is invalid (getMe failed: {exc})")

    scheduler = BackgroundScheduler()
    scheduler.add_job(
        run_reminders,
        "interval",
        seconds=settings.reminder_interval_seconds,
        next_run_time=datetime.now(UTC),
    )
    scheduler.start()
    log.info("worker started; reminder interval=%ss", settings.reminder_interval_seconds)
    try:
        poll_updates(client)
    finally:
        scheduler.shutdown(wait=False)


if __name__ == "__main__":
    main()
