from datetime import UTC, datetime, timedelta

import pytest

from app.models import User
from app.telegram_link import (
    handle_start_command,
    issue_link_code,
    parse_start_command,
    unlink,
)


def make_user(db, username: str = "alice") -> User:
    user = User(username=username, password_hash="x", timezone="UTC")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def start_update(code: str | None, chat_id: int = 100, username: str | None = "alice_tg") -> dict:
    text = "/start" if code is None else f"/start {code}"
    return {
        "update_id": 1,
        "message": {"chat": {"id": chat_id}, "from": {"username": username}, "text": text},
    }


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("/start abc", "abc"),
        ("  /start   abc  ", "abc"),
        ("/start@my_bot abc", "abc"),
        ("/start", None),
        ("/start   ", None),
        ("hello", None),
        ("", None),
        (None, None),
    ],
)
def test_parse_start_command(text, expected):
    assert parse_start_command(text) == expected


def test_valid_code_links_chat_and_enables_notifications(db_session):
    user = make_user(db_session)
    code, _ = issue_link_code(db_session, user)

    outcome = handle_start_command(db_session, start_update(code))

    assert outcome is not None and outcome.linked is True
    db_session.refresh(user)
    assert user.telegram_chat_id == 100
    assert user.telegram_username == "alice_tg"
    assert user.notifications_enabled is True
    assert user.telegram_link_code is None


def test_code_is_single_use(db_session):
    user = make_user(db_session)
    code, _ = issue_link_code(db_session, user)
    handle_start_command(db_session, start_update(code))

    second = handle_start_command(db_session, start_update(code))

    assert second is not None and second.linked is False
    db_session.refresh(user)
    assert user.telegram_chat_id == 100


def test_unknown_code_is_refused(db_session):
    make_user(db_session)

    outcome = handle_start_command(db_session, start_update("nope"))

    assert outcome is not None and outcome.linked is False


def test_expired_code_is_refused(db_session):
    user = make_user(db_session)
    code, _ = issue_link_code(db_session, user)
    user.telegram_link_code_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db_session.commit()

    outcome = handle_start_command(db_session, start_update(code))

    assert outcome is not None and outcome.linked is False
    db_session.refresh(user)
    assert user.telegram_chat_id is None


def test_start_without_code_explains_how_to_link(db_session):
    outcome = handle_start_command(db_session, start_update(None))

    assert outcome is not None and outcome.linked is False
    assert "Settings" in outcome.reply


def test_chat_already_bound_to_another_account_is_refused(db_session):
    first = make_user(db_session, "alice")
    code_first, _ = issue_link_code(db_session, first)
    handle_start_command(db_session, start_update(code_first, chat_id=100))

    second = make_user(db_session, "bob")
    code_second, _ = issue_link_code(db_session, second)
    outcome = handle_start_command(db_session, start_update(code_second, chat_id=100))

    assert outcome is not None and outcome.linked is False
    db_session.refresh(second)
    assert second.telegram_chat_id is None


def test_missing_telegram_username_still_links(db_session):
    user = make_user(db_session)
    code, _ = issue_link_code(db_session, user)

    outcome = handle_start_command(db_session, start_update(code, username=None))

    assert outcome is not None and outcome.linked is True
    db_session.refresh(user)
    assert user.telegram_username is None


def test_update_without_chat_is_ignored(db_session):
    assert handle_start_command(db_session, {"update_id": 1}) is None


def test_issue_link_code_replaces_previous(db_session):
    user = make_user(db_session)
    first, _ = issue_link_code(db_session, user)
    second, _ = issue_link_code(db_session, user)

    assert first != second
    assert handle_start_command(db_session, start_update(first)).linked is False
    assert handle_start_command(db_session, start_update(second)).linked is True


def test_unlink_clears_binding_and_disables_notifications(db_session):
    user = make_user(db_session)
    code, _ = issue_link_code(db_session, user)
    handle_start_command(db_session, start_update(code))

    unlink(db_session, user)

    db_session.refresh(user)
    assert user.telegram_chat_id is None
    assert user.telegram_username is None
    assert user.notifications_enabled is False
