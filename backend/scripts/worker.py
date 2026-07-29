"""Telegram worker: binds chats via `/start` deep links.

Runs as its own compose service rather than inside the API process — the backend runs under
uvicorn `--reload`, which restarts on every file change and would restart a background loop
with it. All domain logic lives in `app/`; this module only drives the loop.

Exactly one instance may poll: the Bot API answers a second concurrent `getUpdates` on the
same token with `409 Conflict`.
"""

from __future__ import annotations

import logging
import signal
import time
from datetime import UTC, date, datetime
from types import FrameType

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app import reminders, telegram_link
from app.config import settings
from app.db import SessionLocal
from app.models import Note, Reminder, User
from app.telegram import (
    TelegramClient,
    TelegramError,
    TelegramNotConfigured,
    TelegramRetryAfter,
    build_client,
)

POLL_TIMEOUT_SECONDS = 25
IDLE_SLEEP_SECONDS = 60
SCHEMA_WAIT_SECONDS = 2
SCHEMA_WAIT_MAX_SECONDS = 30
TICK_INTERVAL_SECONDS = 30
POLL_BACKOFF_BASE_SECONDS = 2
POLL_BACKOFF_MAX_SECONDS = 60
MAX_UPDATE_ATTEMPTS = 5
DELIVERY_BATCH_LIMIT = 50

logger = logging.getLogger("worker")

_shutdown = False
# Consecutive failures per update, so one unprocessable update cannot wedge the queue forever.
# Deliberately in-process and ephemeral: a restart resets the counters, which just means the
# update gets its retries again — the durable state that matters lives in the outbox table.
_update_failures: dict[int, int] = {}
# Where the last materialisation pass stopped. Ephemeral by design: losing it on restart only
# means the next sweep starts from the beginning of the window.
_materialize_after: tuple[date, int] | None = None


def _request_shutdown(signum: int, frame: FrameType | None) -> None:
    global _shutdown
    _shutdown = True
    logger.info("received signal %s, finishing current iteration", signum)


def poll_backoff(consecutive_failures: int) -> int:
    """Exponential backoff, capped, so a long outage stays quiet instead of flooding the log."""
    return min(
        POLL_BACKOFF_BASE_SECONDS * 2 ** (consecutive_failures - 1), POLL_BACKOFF_MAX_SECONDS
    )


def wait_for_schema() -> None:
    """Block until migrations have run.

    The backend service owns `alembic upgrade head`, so on a fresh volume this process starts
    against a database that has no tables yet. Retrying beats crash-looping.

    Probes `reminders` — the table created by the newest migration — rather than `users`, which
    exists from 0001 onwards. Probing an early table would let this return while the tables the
    worker actually needs are still missing, which is precisely the case it exists to cover.
    """
    delay = SCHEMA_WAIT_SECONDS
    while not _shutdown:
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1 FROM reminders LIMIT 1"))
            return
        except SQLAlchemyError:
            logger.info("schema not ready, retrying in %ss", delay)
        finally:
            db.close()
        time.sleep(delay)
        delay = min(delay * 2, SCHEMA_WAIT_MAX_SECONDS)


def process_updates(client: TelegramClient, offset: int | None) -> int | None:
    """Handle one batch of updates and return the next offset.

    The offset is never reset at startup: `/start` handling is idempotent, so replaying is
    harmless, whereas discarding the backlog would silently swallow button presses made while
    this process was down.
    """
    updates = client.get_updates(offset, POLL_TIMEOUT_SECONDS)
    next_offset = offset
    for update in updates:
        update_id = update.get("update_id")
        if not isinstance(update_id, int):
            # Without a usable id the offset cannot move past it, so retrying would be pointless.
            # The Bot API always sends one; this only guards against a malformed payload.
            logger.error("update without a usable update_id, skipping")
            continue

        db = SessionLocal()
        try:
            outcome = telegram_link.handle_start_command(db, update)
        except SQLAlchemyError:
            db.rollback()
            attempts = _update_failures.get(update_id, 0) + 1
            _update_failures[update_id] = attempts
            if attempts >= MAX_UPDATE_ATTEMPTS:
                # Leaving it unconfirmed forever would wedge every later binding behind one
                # unprocessable update. Give up loudly and move on.
                logger.error(
                    "update %s failed %s times, skipping it to unblock the queue",
                    update_id,
                    attempts,
                )
                del _update_failures[update_id]
                next_offset = update_id + 1
                continue
            # Stop without confirming this update or the rest of the batch. Advancing the offset
            # here would tell Telegram we handled it, and a transient database blip would cost the
            # user their /start with no way to notice — the same silent loss the startup flush
            # avoids.
            logger.exception("failed to handle update %s, leaving it unconfirmed", update_id)
            return next_offset
        finally:
            db.close()

        # Only now is the update genuinely handled.
        _update_failures.pop(update_id, None)
        next_offset = update_id + 1

        if outcome is None:
            continue
        _reply(client, outcome)
        if outcome.linked:
            logger.info("linked chat %s", outcome.chat_id)
    return next_offset


def _reply(client: TelegramClient, outcome: telegram_link.LinkOutcome) -> None:
    """Answer the user, retrying once past a rate limit.

    Worth the retry: the binding is already committed, so without a reply the user is linked and
    has no way to know it.
    """
    try:
        client.send_message(outcome.chat_id, outcome.reply)
        return
    except TelegramRetryAfter as exc:
        time.sleep(exc.seconds)
    except TelegramError:
        logger.exception("failed to reply to chat %s", outcome.chat_id)
        return
    try:
        client.send_message(outcome.chat_id, outcome.reply)
    except TelegramError:
        logger.warning("could not confirm the link to chat %s", outcome.chat_id)


def tick(client: TelegramClient, now: datetime) -> int:
    """One delivery pass: reconcile the outbox, then send whatever is due."""
    global _materialize_after
    db = SessionLocal()
    try:
        reminders.cancel_stale(db, now)
        _, _materialize_after = reminders.materialize_due(db, now, _materialize_after)
        reminders.resync_pending(db, now)

        sent = 0
        attempted: set[int] = set()
        while len(attempted) < DELIVERY_BATCH_LIMIT:
            reminder = reminders.claim_next(db, now, attempted)
            if reminder is None:
                break
            attempted.add(reminder.id)
            note = db.get(Note, reminder.note_id)
            user = db.get(User, reminder.user_id)
            # Re-check immediately before sending, not only in cancel_stale at the top of the
            # pass: the API can edit the note in between, and a message is not retractable.
            if not reminders.still_deliverable(reminder, note, user):
                reminder.status = Reminder.STATUS_CANCELLED
                db.commit()
                logger.info("reminder %s no longer applies, cancelled", reminder.id)
                continue
            try:
                client.send_message(user.telegram_chat_id, reminders.render_message(note))
            except TelegramRetryAfter as exc:
                reminders.mark_failed(db, reminder, f"rate limited, retry after {exc.seconds}s")
                logger.warning("rate limited, pausing delivery for %ss", exc.seconds)
                time.sleep(exc.seconds)
                break
            except TelegramError as exc:
                reminders.mark_failed(db, reminder, str(exc))
                logger.warning("delivery failed for reminder %s: %s", reminder.id, exc)
                continue
            reminders.mark_sent(db, reminder, now)
            sent += 1
            logger.info("sent reminder %s for note %s", reminder.id, note.id)
        return sent
    finally:
        db.close()


def run() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    # httpx logs the full request URL at INFO, and the bot token lives in that URL.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    signal.signal(signal.SIGTERM, _request_shutdown)
    signal.signal(signal.SIGINT, _request_shutdown)

    if not settings.bot_configured:
        logger.warning(
            "TELEGRAM_BOT_TOKEN / TELEGRAM_BOT_USERNAME are not set — worker is idle. "
            "Set them in backend/.env to enable reminders."
        )
        while not _shutdown:
            time.sleep(IDLE_SLEEP_SECONDS)
        return

    wait_for_schema()
    client = build_client()
    logger.info("worker started, polling as @%s", settings.telegram_bot_username)

    offset: int | None = None
    last_tick = 0.0
    failures = 0
    while not _shutdown:
        try:
            offset = process_updates(client, offset)
            failures = 0
        except TelegramRetryAfter as exc:
            logger.warning("rate limited, sleeping %ss", exc.seconds)
            time.sleep(exc.seconds)
        except TelegramNotConfigured:
            logger.error("bot token became invalid, stopping")
            return
        except TelegramError as exc:
            # Network drops to api.telegram.org come in bursts lasting minutes. A flat 2s retry
            # turns one outage into hundreds of tracebacks, which buries anything real.
            failures += 1
            delay = poll_backoff(failures)
            if failures == 1:
                logger.exception("polling failed, retrying in %ss", delay)
            else:
                logger.warning(
                    "polling still failing (%s in a row): %s; retrying in %ss", failures, exc, delay
                )
            time.sleep(delay)

        # Long polling returns immediately when updates are waiting, so pace delivery on its own
        # clock instead of letting a chatty chat turn it into a busy loop.
        if time.monotonic() - last_tick >= TICK_INTERVAL_SECONDS:
            last_tick = time.monotonic()
            try:
                tick(client, datetime.now(UTC))
            except (SQLAlchemyError, TelegramError):
                logger.exception("delivery pass failed, will retry next tick")
    logger.info("worker stopped")


if __name__ == "__main__":
    run()
