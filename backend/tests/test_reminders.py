import os

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test-secret-with-at-least-32-characters")

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import Note, ReminderSent, User
from app.reminders import (
    due_reminders,
    format_message,
    issue_link_code,
    parse_start_command,
    process_due,
    resolve_link_code,
    user_today,
)

NO_SLEEP = lambda _seconds: None  # noqa: E731 - test stub


@pytest.fixture()
def session(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'r.db'}",
        connect_args={"check_same_thread": False},
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, future=True)
    db = Session()
    try:
        yield db
    finally:
        db.close()


def _user(db, *, enabled=True, chat="123", tz="UTC", name="u"):
    user = User(
        username=name,
        password_hash="x",
        timezone=tz,
        telegram_enabled=enabled,
        telegram_chat_id=chat,
    )
    db.add(user)
    db.flush()
    return user


def _note(db, user, *, note_date, archived=False):
    note = Note(
        user_id=user.id,
        title="Pay rent",
        content="the big one",
        tags=[],
        note_date=note_date,
        archived_at=datetime.now(UTC) if archived else None,
    )
    db.add(note)
    db.flush()
    return note


class RecordingSender:
    def __init__(self, fail_times=0):
        self.calls = []
        self.fail_times = fail_times

    def __call__(self, chat_id, text):
        self.calls.append((chat_id, text))
        if len(self.calls) <= self.fail_times:
            raise RuntimeError("boom")


def test_due_includes_past_and_today(session):
    user = _user(session)
    _note(session, user, note_date=date(2026, 6, 3))
    _note(session, user, note_date=date(2026, 6, 1))
    _note(session, user, note_date=date(2026, 6, 10))  # future, not due
    session.commit()

    due = due_reminders(session, datetime(2026, 6, 3, 12, 0, tzinfo=UTC))
    assert {n.note_date for _, n in due} == {date(2026, 6, 1), date(2026, 6, 3)}


def test_disabled_unlinked_and_archived_are_skipped(session):
    disabled = _user(session, enabled=False, name="off")
    _note(session, disabled, note_date=date(2026, 6, 1))
    unlinked = _user(session, chat=None, name="nolink")
    _note(session, unlinked, note_date=date(2026, 6, 1))
    active = _user(session, name="on")
    _note(session, active, note_date=date(2026, 6, 1), archived=True)
    session.commit()

    due = due_reminders(session, datetime(2026, 6, 3, 12, 0, tzinfo=UTC))
    assert due == []


def test_timezone_boundary(session):
    ahead = _user(session, tz="Pacific/Kiritimati", name="ahead")  # UTC+14
    behind = _user(session, tz="Pacific/Honolulu", name="behind")  # UTC-10
    _note(session, ahead, note_date=date(2026, 6, 3))
    _note(session, behind, note_date=date(2026, 6, 3))
    session.commit()

    now = datetime(2026, 6, 3, 2, 0, tzinfo=UTC)  # Kiritimati: 3rd; Honolulu: 2nd
    assert user_today("Pacific/Kiritimati", now) == date(2026, 6, 3)
    assert user_today("Pacific/Honolulu", now) == date(2026, 6, 2)

    due = due_reminders(session, now)
    assert [u.username for u, _ in due] == ["ahead"]


def test_unknown_timezone_falls_back_to_utc(session):
    assert user_today("Not/AZone", datetime(2026, 6, 3, 12, 0, tzinfo=UTC)) == date(2026, 6, 3)


def test_process_due_is_idempotent(session):
    user = _user(session)
    _note(session, user, note_date=date(2026, 6, 3))
    session.commit()
    now = datetime(2026, 6, 3, 12, 0, tzinfo=UTC)

    sender = RecordingSender()
    assert process_due(session, sender, now_utc=now, sleep=NO_SLEEP) == 1
    # Second run: ledger row exists, nothing re-sent.
    assert process_due(session, sender, now_utc=now, sleep=NO_SLEEP) == 0
    assert len(sender.calls) == 1
    assert session.query(ReminderSent).count() == 1


def test_process_due_retries_then_succeeds(session):
    user = _user(session)
    _note(session, user, note_date=date(2026, 6, 3))
    session.commit()
    now = datetime(2026, 6, 3, 12, 0, tzinfo=UTC)

    sender = RecordingSender(fail_times=2)  # fails twice, 3rd attempt ok
    assert process_due(session, sender, now_utc=now, attempts=3, sleep=NO_SLEEP) == 1
    assert len(sender.calls) == 3
    assert session.query(ReminderSent).count() == 1


def test_process_due_skips_already_claimed(session):
    # A row written by a concurrent tick/worker must block delivery entirely.
    user = _user(session)
    note = _note(session, user, note_date=date(2026, 6, 3))
    session.add(ReminderSent(note_id=note.id, note_date=date(2026, 6, 3)))
    session.commit()

    sender = RecordingSender()
    sent = process_due(
        session, sender, now_utc=datetime(2026, 6, 3, 12, 0, tzinfo=UTC), sleep=NO_SLEEP
    )
    assert sent == 0
    assert sender.calls == []  # never delivered a second time
    assert session.query(ReminderSent).count() == 1


def test_process_due_gives_up_after_attempts_no_ledger(session):
    user = _user(session)
    _note(session, user, note_date=date(2026, 6, 3))
    session.commit()
    now = datetime(2026, 6, 3, 12, 0, tzinfo=UTC)

    sender = RecordingSender(fail_times=99)
    assert process_due(session, sender, now_utc=now, attempts=3, sleep=NO_SLEEP) == 0
    assert len(sender.calls) == 3
    assert session.query(ReminderSent).count() == 0  # left for next tick


def test_changing_date_makes_note_eligible_again(session):
    user = _user(session)
    note = _note(session, user, note_date=date(2026, 6, 3))
    session.commit()

    sender = RecordingSender()
    process_due(session, sender, now_utc=datetime(2026, 6, 3, 12, 0, tzinfo=UTC), sleep=NO_SLEEP)
    note.note_date = date(2026, 6, 5)
    session.commit()
    process_due(session, sender, now_utc=datetime(2026, 6, 5, 12, 0, tzinfo=UTC), sleep=NO_SLEEP)
    assert len(sender.calls) == 2


def test_format_message_includes_title_date_and_preview(session):
    user = _user(session)
    note = _note(session, user, note_date=date(2026, 6, 3))
    msg = format_message(note)
    assert "Pay rent" in msg
    assert "2026-06-03" in msg
    assert "the big one" in msg


def test_parse_start_command():
    assert parse_start_command("/start abc123") == "abc123"
    assert parse_start_command("/start") is None
    assert parse_start_command("hello") is None
    assert parse_start_command("") is None


def test_issue_and_resolve_link_code(session):
    user = _user(session, chat=None, enabled=False)
    session.commit()
    code = issue_link_code(session, user, now_utc=datetime(2026, 6, 3, 12, 0, tzinfo=UTC))

    linked = resolve_link_code(
        session, code, "555", now_utc=datetime(2026, 6, 3, 12, 1, tzinfo=UTC)
    )
    assert linked is not None
    assert linked.telegram_chat_id == "555"
    assert linked.telegram_enabled is True
    assert linked.telegram_link_code is None
    # Code is single-use now.
    assert resolve_link_code(session, code, "666") is None


def test_resolve_link_code_expired(session):
    user = _user(session, chat=None, enabled=False)
    session.commit()
    code = issue_link_code(session, user, now_utc=datetime(2026, 6, 3, 12, 0, tzinfo=UTC))
    later = datetime(2026, 6, 3, 12, 0, tzinfo=UTC) + timedelta(hours=1)
    assert resolve_link_code(session, code, "555", now_utc=later) is None


def test_resolve_link_code_unknown(session):
    assert resolve_link_code(session, "nope", "555") is None
