"""Delivery-pass tests: one iteration of the worker, never the endless loop."""

import logging
from datetime import UTC, date, datetime, time

import pytest

import scripts.worker as worker
from app import bot_commands, reminders
from app.models import Note, Reminder, User
from app.telegram import TelegramError, TelegramRetryAfter

DUE = datetime(2026, 8, 1, 9, 0, tzinfo=UTC)
NOT_DUE = datetime(2026, 8, 1, 6, 0, tzinfo=UTC)


class FakeClient:
    """Counts sends and can be told to fail, so tick() never touches the network."""

    def __init__(self, error: Exception | None = None):
        self.sent: list[tuple[int, str]] = []
        self.error = error

    def get_updates(self, offset, timeout):
        return []

    def send_message(self, chat_id: int, text: str) -> None:
        if self.error is not None:
            raise self.error
        self.sent.append((chat_id, text))


@pytest.fixture()
def wired(db_session, monkeypatch):
    """Point the worker at the test session instead of the real engine."""
    monkeypatch.setattr(worker, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)
    return db_session


def seed(db, *, enabled=True, chat_id=100, note_date=date(2026, 8, 1)) -> Note:
    user = User(
        username=f"u{chat_id}",
        password_hash="x",
        timezone="UTC",
        reminder_time=time(9, 0),
        notifications_enabled=enabled,
        telegram_chat_id=chat_id,
    )
    db.add(user)
    db.commit()
    note = Note(user_id=user.id, title="Standup", content="agenda", tags=[], note_date=note_date)
    db.add(note)
    db.commit()
    return note


def test_poll_backoff_grows_then_caps():
    delays = [worker.poll_backoff(n) for n in range(1, 9)]

    assert delays == [2, 4, 8, 16, 32, 60, 60, 60]
    # A five-minute outage costs ~10 log lines instead of ~150.
    assert sum(delays[:6]) >= 120


def test_incomplete_sweep_is_announced(wired, monkeypatch, caplog):
    """A sweep that has not caught up delays reminders; it must not be invisible."""
    monkeypatch.setattr(reminders, "RECONCILE_LIMIT", 1)
    seed(wired)
    seed(wired, chat_id=101)

    with caplog.at_level(logging.INFO, logger="worker"):
        worker.tick(FakeClient(), NOT_DUE)

    assert "sweep in progress" in caplog.text


def test_completed_reconciliation_reports_counts_without_the_sweep_marker(wired, caplog):
    seed(wired)

    with caplog.at_level(logging.INFO, logger="worker"):
        worker.tick(FakeClient(), NOT_DUE)

    assert "materialised=1" in caplog.text
    assert "sweep in progress" not in caplog.text


def test_quiet_when_there_is_nothing_to_reconcile(wired, caplog):
    with caplog.at_level(logging.INFO, logger="worker"):
        worker.tick(FakeClient(), NOT_DUE)

    # A healthy idle worker would otherwise log every 30 seconds forever.
    assert "reconciled" not in caplog.text


def test_due_note_is_delivered(wired):
    seed(wired)
    client = FakeClient()

    assert worker.tick(client, DUE) == 1

    assert len(client.sent) == 1
    chat_id, text = client.sent[0]
    assert chat_id == 100
    assert "Standup" in text
    assert wired.query(Reminder).one().status == Reminder.STATUS_SENT


def test_second_tick_does_not_resend(wired):
    seed(wired)
    client = FakeClient()

    worker.tick(client, DUE)
    worker.tick(client, DUE)

    assert len(client.sent) == 1


def test_settings_change_between_ticks_still_sends_once(wired):
    note = seed(wired)
    client = FakeClient()
    worker.tick(client, DUE)

    user = wired.get(User, note.user_id)
    user.timezone = "Asia/Bishkek"
    wired.commit()
    worker.tick(client, DUE)

    assert len(client.sent) == 1
    assert wired.query(Reminder).count() == 1


def test_not_due_yet_is_not_delivered(wired):
    seed(wired)
    client = FakeClient()

    assert worker.tick(client, datetime(2026, 8, 1, 6, 0, tzinfo=UTC)) == 0
    assert client.sent == []


def test_disabled_notifications_produce_no_rows(wired):
    seed(wired, enabled=False)
    client = FakeClient()

    assert worker.tick(client, DUE) == 0
    assert wired.query(Reminder).count() == 0


def test_unlinked_account_produces_no_rows(wired):
    seed(wired, chat_id=None)
    client = FakeClient()

    assert worker.tick(client, DUE) == 0
    assert wired.query(Reminder).count() == 0


def test_rate_limit_keeps_the_reminder_pending(wired, monkeypatch):
    monkeypatch.setattr(worker.time, "sleep", lambda _seconds: None)
    seed(wired)
    client = FakeClient(error=TelegramRetryAfter(3))

    assert worker.tick(client, DUE) == 0

    row = wired.query(Reminder).one()
    assert row.status == Reminder.STATUS_PENDING
    assert row.attempts == 1


def test_retry_after_rate_limit_succeeds(wired, monkeypatch):
    monkeypatch.setattr(worker.time, "sleep", lambda _seconds: None)
    seed(wired)
    failing = FakeClient(error=TelegramRetryAfter(3))
    worker.tick(failing, DUE)

    healthy = FakeClient()
    assert worker.tick(healthy, DUE) == 1
    assert wired.query(Reminder).one().status == Reminder.STATUS_SENT


def test_repeated_failures_end_as_failed_without_stopping_the_worker(wired):
    seed(wired)
    client = FakeClient(error=TelegramError("chat not found"))

    for _ in range(reminders.MAX_ATTEMPTS):
        worker.tick(client, DUE)

    row = wired.query(Reminder).one()
    assert row.status == Reminder.STATUS_FAILED
    assert row.attempts == reminders.MAX_ATTEMPTS
    assert row.last_error == "chat not found"


def test_date_cleared_between_reconcile_and_send_is_not_delivered(wired, monkeypatch):
    """The API can edit a note mid-pass; a message cannot be taken back once sent."""
    note = seed(wired)
    client = FakeClient()
    original_claim = reminders.claim_next

    def claim_then_clear_the_date(db, now, exclude):
        claimed = original_claim(db, now, exclude)
        if claimed is not None:
            note.note_date = None
            db.commit()
        return claimed

    monkeypatch.setattr(reminders, "claim_next", claim_then_clear_the_date)

    assert worker.tick(client, DUE) == 0
    assert client.sent == []
    assert wired.query(Reminder).one().status == Reminder.STATUS_CANCELLED


def test_notifications_disabled_between_reconcile_and_send_is_not_delivered(wired, monkeypatch):
    note = seed(wired)
    client = FakeClient()
    original_claim = reminders.claim_next

    def claim_then_disable(db, now, exclude):
        claimed = original_claim(db, now, exclude)
        if claimed is not None:
            db.get(User, note.user_id).notifications_enabled = False
            db.commit()
        return claimed

    monkeypatch.setattr(reminders, "claim_next", claim_then_disable)

    assert worker.tick(client, DUE) == 0
    assert client.sent == []


def test_archiving_after_materialisation_cancels_delivery(wired):
    note = seed(wired)
    client = FakeClient()
    worker.tick(client, datetime(2026, 8, 1, 6, 0, tzinfo=UTC))

    note.archived_at = DUE
    wired.commit()
    worker.tick(client, DUE)

    assert client.sent == []
    assert wired.query(Reminder).one().status == Reminder.STATUS_CANCELLED


def test_pause_from_the_bot_stops_delivery(wired):
    seed(wired)  # seed already binds this user to chat 100
    bot_commands.handle_update(
        wired,
        {
            "update_id": 1,
            "message": {"chat": {"id": 100}, "from": {"language_code": "en"}, "text": "/pause"},
        },
    )
    client = FakeClient()

    # Proven against the outbox: a reassuring sentence is not evidence a reminder stayed home.
    assert worker.tick(client, DUE) == 0
    assert client.sent == []
