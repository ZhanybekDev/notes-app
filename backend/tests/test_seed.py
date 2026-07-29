"""Seeding must not cost the tester their Telegram binding."""

from datetime import UTC, datetime, time

import pytest

from app.models import Note, User
from scripts import seed as seed_script


@pytest.fixture()
def seeding(db_session, monkeypatch):
    monkeypatch.setattr(seed_script, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)
    return db_session


def demo(db) -> User:
    return db.query(User).filter(User.username == seed_script.DEMO_USERNAME).one()


def test_creates_the_account_and_its_notes(seeding):
    seed_script.seed()

    user = demo(seeding)
    assert user.timezone == "UTC"
    assert seeding.query(Note).filter(Note.user_id == user.id).count() == 5


def test_keeps_the_telegram_binding_across_reseeds(seeding):
    seed_script.seed()
    user = demo(seeding)
    user.telegram_chat_id = 4242
    user.telegram_username = "tester"
    user.telegram_language = "ru"
    user.telegram_linked_at = datetime.now(UTC)
    user.notifications_enabled = True
    user.timezone = "Asia/Bishkek"
    user.reminder_time = time(7, 30)
    seeding.commit()

    seed_script.seed()

    user = demo(seeding)
    assert user.telegram_chat_id == 4242
    assert user.telegram_username == "tester"
    assert user.telegram_language == "ru"
    assert user.notifications_enabled is True
    assert user.timezone == "Asia/Bishkek"
    assert user.reminder_time == time(7, 30)


def test_replaces_the_notes_rather_than_piling_them_up(seeding):
    seed_script.seed()
    user = demo(seeding)
    seeding.add(Note(user_id=user.id, title="mine", content="", tags=[], note_date=None))
    seeding.commit()

    seed_script.seed()

    titles = [n.title for n in seeding.query(Note).filter(Note.user_id == user.id).all()]
    assert "mine" not in titles
    assert len(titles) == 5


def test_restores_the_documented_password(seeding):
    from app.auth import verify_password

    seed_script.seed()
    user = demo(seeding)
    user.password_hash = "tampered"
    seeding.commit()

    seed_script.seed()

    assert verify_password(seed_script.DEMO_PASSWORD, demo(seeding).password_hash)
