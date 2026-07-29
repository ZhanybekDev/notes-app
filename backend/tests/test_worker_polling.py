"""Tests for the polling half of the worker.

This loop is invisible to the coverage gate (`pytest.ini` measures `--cov=app`, and this code
lives in `scripts/`), which is exactly why it needs explicit tests rather than trust.
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.exc import OperationalError

import scripts.worker as worker
from app.models import User
from app.telegram import TelegramError, TelegramRetryAfter
from app.telegram_link import issue_link_code


class RecordingClient:
    def __init__(self, batches: list[list[dict]], send_error: Exception | None = None):
        self.batches = batches
        self.calls: list[int | None] = []
        self.sent: list[tuple[int, str]] = []
        self.send_error = send_error

    def get_updates(self, offset, timeout):
        self.calls.append(offset)
        return self.batches.pop(0) if self.batches else []

    def send_message(self, chat_id, text):
        if self.send_error is not None:
            raise self.send_error
        self.sent.append((chat_id, text))


@pytest.fixture()
def wired(db_session, monkeypatch):
    monkeypatch.setattr(worker, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)
    return db_session


def start_update(update_id: int, code: str, chat_id: int = 100) -> dict:
    return {
        "update_id": update_id,
        "message": {
            "chat": {"id": chat_id},
            "from": {"username": "alice"},
            "text": f"/start {code}",
        },
    }


def make_user(db, username="alice") -> User:
    user = User(username=username, password_hash="x", timezone="UTC")
    db.add(user)
    db.commit()
    return user


def test_offset_advances_past_handled_updates(wired):
    user = make_user(wired)
    code, _ = issue_link_code(wired, user)
    client = RecordingClient([[start_update(7, code)]])

    assert worker.process_updates(client, None) == 8
    assert client.calls == [None]


def test_offset_is_not_advanced_when_the_database_fails(wired, monkeypatch):
    """A transient DB blip must not cost the user their /start."""

    def explode(db, update):
        raise OperationalError("SELECT 1", {}, Exception("connection reset"))

    monkeypatch.setattr(worker.telegram_link, "handle_start_command", explode)
    client = RecordingClient([[start_update(7, "whatever")]])

    # Offset stays where it was, so Telegram will hand the update back on the next poll.
    assert worker.process_updates(client, 5) == 5
    assert client.sent == []


def test_failure_does_not_confirm_the_rest_of_the_batch(wired, monkeypatch):
    user = make_user(wired)
    code, _ = issue_link_code(wired, user)
    calls: list[dict] = []
    real = worker.telegram_link.handle_start_command

    def fail_on_second(db, update):
        calls.append(update)
        if len(calls) == 2:
            raise OperationalError("SELECT 1", {}, Exception("connection reset"))
        return real(db, update)

    monkeypatch.setattr(worker.telegram_link, "handle_start_command", fail_on_second)
    client = RecordingClient([[start_update(7, code), start_update(8, "x"), start_update(9, "y")]])

    # Only the first update is confirmed; 8 and 9 are left for the next poll.
    assert worker.process_updates(client, None) == 8
    assert len(calls) == 2


def test_successful_link_is_answered(wired):
    user = make_user(wired)
    code, _ = issue_link_code(wired, user)
    client = RecordingClient([[start_update(1, code)]])

    worker.process_updates(client, None)

    assert len(client.sent) == 1
    chat_id, text = client.sent[0]
    assert chat_id == 100
    assert "alice" in text
    wired.refresh(user)
    assert user.telegram_chat_id == 100


def test_update_without_a_chat_is_skipped_but_still_confirmed(wired):
    client = RecordingClient([[{"update_id": 3}]])

    assert worker.process_updates(client, None) == 4
    assert client.sent == []


def test_reply_failure_does_not_lose_the_binding(wired):
    user = make_user(wired)
    code, _ = issue_link_code(wired, user)
    client = RecordingClient([[start_update(1, code)]], send_error=TelegramError("blocked"))

    assert worker.process_updates(client, None) == 2

    wired.refresh(user)
    assert user.telegram_chat_id == 100


def test_reply_rate_limit_is_honoured(wired, monkeypatch):
    slept: list[int] = []
    monkeypatch.setattr(worker.time, "sleep", lambda seconds: slept.append(seconds))
    user = make_user(wired)
    code, _ = issue_link_code(wired, user)
    client = RecordingClient([[start_update(1, code)]], send_error=TelegramRetryAfter(4))

    worker.process_updates(client, None)

    assert slept == [4]


def test_expired_code_is_answered_and_confirmed(wired):
    user = make_user(wired)
    code, _ = issue_link_code(wired, user)
    user.telegram_link_code_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    wired.commit()
    client = RecordingClient([[start_update(2, code)]])

    assert worker.process_updates(client, None) == 3

    assert "expired" in client.sent[0][1]
    wired.refresh(user)
    assert user.telegram_chat_id is None


class TestWaitForSchema:
    def test_probes_the_table_created_by_the_newest_migration(self, wired, monkeypatch):
        """Probing `users` would pass while `reminders` was still missing."""
        seen: list[str] = []

        def record(statement, *args, **kwargs):
            seen.append(str(statement))
            return None

        monkeypatch.setattr(wired, "execute", record)
        worker.wait_for_schema()

        assert "reminders" in seen[0]

    def test_retries_until_the_schema_appears(self, wired, monkeypatch):
        attempts = {"n": 0}
        monkeypatch.setattr(worker.time, "sleep", lambda _seconds: None)

        def fail_twice(statement, *args, **kwargs):
            attempts["n"] += 1
            if attempts["n"] < 3:
                raise OperationalError("SELECT 1", {}, Exception("no such table"))
            return None

        monkeypatch.setattr(wired, "execute", fail_twice)
        worker.wait_for_schema()

        assert attempts["n"] == 3
