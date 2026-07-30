from datetime import UTC, date, datetime, time, timedelta

import pytest

from app import bot_commands
from app.models import Note, User
from app.telegram_link import issue_link_code


def make_user(db, username="alice", timezone="UTC", **kwargs) -> User:
    user = User(username=username, password_hash="x", timezone=timezone, **kwargs)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def message(text, chat_id=100, language="en", username="alice_tg"):
    return {
        "update_id": 1,
        "message": {
            "chat": {"id": chat_id},
            "from": {"username": username, "language_code": language},
            "text": text,
        },
    }


def link(db, user, chat_id=100, language="en"):
    code, _ = issue_link_code(db, user)
    bot_commands.handle_update(db, message(f"/start {code}", chat_id=chat_id, language=language))
    return user


def add_note(db, user, title, note_date, archived=False):
    note = Note(
        user_id=user.id,
        title=title,
        content="",
        tags=[],
        note_date=note_date,
        archived_at=datetime(2026, 7, 1, tzinfo=UTC) if archived else None,
    )
    db.add(note)
    db.commit()
    return note


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("/start abc", ("start", "abc")),
        ("  /start   abc  ", ("start", "abc")),
        ("/start@my_bot abc", ("start", "abc")),
        ("/START", ("start", None)),
        ("/start", ("start", None)),
        ("/start   ", ("start", None)),
        ("hello", (None, None)),
        ("", (None, None)),
    ],
)
def test_parse(text, expected):
    # Ported from the parse_start_command test that goes away with it, generalised to any command.
    assert bot_commands._parse(text) == expected


class TestRouting:
    def test_ignores_a_message_without_text(self, db_session):
        update = message("hi")
        del update["message"]["text"]

        assert bot_commands.handle_update(db_session, update) is None

    def test_ignores_an_update_without_a_chat(self, db_session):
        assert bot_commands.handle_update(db_session, {"update_id": 1}) is None

    def test_unrecognised_text_gets_the_help(self, db_session):
        reply = bot_commands.handle_update(db_session, message("what can you do"))

        assert "/today" in reply.text
        assert reply.chat_id == 100

    def test_help_lists_every_advertised_command(self, db_session):
        reply = bot_commands.handle_update(db_session, message("/help"))

        for name, _ in bot_commands.COMMANDS:
            assert f"/{name}" in reply.text

    def test_help_needs_no_link(self, db_session):
        assert bot_commands.handle_update(db_session, message("/help")) is not None

    def test_command_with_a_bot_suffix_is_understood(self, db_session):
        reply = bot_commands.handle_update(db_session, message("/help@notes_bot"))

        assert "/today" in reply.text

    def test_help_tells_an_unlinked_chat_how_to_connect(self, db_session):
        """The menu button reaches /help without ever passing through the deep link."""
        reply = bot_commands.handle_update(db_session, message("/help"))

        assert "Settings" in reply.text

    def test_help_does_not_nag_a_linked_chat(self, db_session):
        link(db_session, make_user(db_session))

        reply = bot_commands.handle_update(db_session, message("/help"))

        assert "Settings" not in reply.text

    def test_an_advertised_command_without_a_handler_does_not_resume(self, db_session, monkeypatch):
        """The router used to fall through to /resume, so a new command would un-pause silently."""
        user = link(db_session, make_user(db_session))
        bot_commands.handle_update(db_session, message("/pause"))
        monkeypatch.setattr(
            bot_commands, "COMMANDS", (*bot_commands.COMMANDS, ("week", "cmd_help"))
        )
        monkeypatch.setattr(bot_commands, "_COMMAND_NAMES", bot_commands._COMMAND_NAMES | {"week"})

        reply = bot_commands.handle_update(db_session, message("/week"))

        assert "/today" in reply.text
        db_session.refresh(user)
        assert user.notifications_enabled is False


class TestStart:
    def test_start_without_a_code_explains_how_to_link(self, db_session):
        reply = bot_commands.handle_update(db_session, message("/start"))

        assert "Settings" in reply.text

    def test_start_from_a_linked_chat_shows_what_the_bot_can_do(self, db_session):
        """Telegram sends a bare /start from the START button, which every fresh chat view shows."""
        link(db_session, make_user(db_session))

        reply = bot_commands.handle_update(db_session, message("/start"))

        assert "/today" in reply.text
        assert "Settings" not in reply.text

    def test_valid_code_links_and_confirms(self, db_session):
        user = make_user(db_session)
        code, _ = issue_link_code(db_session, user)

        reply = bot_commands.handle_update(db_session, message(f"/start {code}"))

        assert "alice" in reply.text
        db_session.refresh(user)
        assert user.telegram_chat_id == 100
        assert user.telegram_username == "alice_tg"
        assert user.notifications_enabled is True
        # The deep link is a URL the user may have pasted or forwarded; redeeming it has to burn it.
        assert user.telegram_link_code is None
        assert user.telegram_link_code_expires_at is None

    def test_a_redeemed_code_cannot_be_used_again(self, db_session):
        user = make_user(db_session)
        code, _ = issue_link_code(db_session, user)
        bot_commands.handle_update(db_session, message(f"/start {code}"))

        reply = bot_commands.handle_update(db_session, message(f"/start {code}", chat_id=999))

        assert "expired" in reply.text
        db_session.refresh(user)
        assert user.telegram_chat_id == 100

    def test_expired_code_is_refused(self, db_session):
        user = make_user(db_session)
        code, _ = issue_link_code(db_session, user)
        user.telegram_link_code_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db_session.commit()

        reply = bot_commands.handle_update(db_session, message(f"/start {code}"))

        assert "expired" in reply.text
        db_session.refresh(user)
        assert user.telegram_chat_id is None

    def test_a_chat_already_taken_is_refused(self, db_session):
        first = make_user(db_session, "alice")
        code_first, _ = issue_link_code(db_session, first)
        bot_commands.handle_update(db_session, message(f"/start {code_first}"))
        second = make_user(db_session, "bob")
        code_second, _ = issue_link_code(db_session, second)

        reply = bot_commands.handle_update(db_session, message(f"/start {code_second}"))

        assert "already connected" in reply.text
        db_session.refresh(second)
        assert second.telegram_chat_id is None

    def test_the_confirmation_follows_the_client_language(self, db_session):
        user = make_user(db_session)
        code, _ = issue_link_code(db_session, user)

        reply = bot_commands.handle_update(db_session, message(f"/start {code}", language="ru"))

        assert "Готово" in reply.text


class TestListings:
    def test_today_refuses_an_unlinked_chat(self, db_session):
        reply = bot_commands.handle_update(db_session, message("/today"))

        assert "Settings" in reply.text

    def test_today_lists_only_today(self, db_session):
        user = link(db_session, make_user(db_session))
        today = datetime.now(UTC).date()
        add_note(db_session, user, "Due now", today)
        add_note(db_session, user, "Later", today + timedelta(days=1))
        add_note(db_session, user, "Undated", None)

        reply = bot_commands.handle_update(db_session, message("/today"))

        assert "Due now" in reply.text
        assert "Later" not in reply.text
        assert "Undated" not in reply.text

    def test_today_skips_archived(self, db_session):
        user = link(db_session, make_user(db_session))
        add_note(db_session, user, "Filed away", datetime.now(UTC).date(), archived=True)

        reply = bot_commands.handle_update(db_session, message("/today"))

        assert "Filed away" not in reply.text

    def test_today_says_so_when_empty(self, db_session):
        link(db_session, make_user(db_session))

        reply = bot_commands.handle_update(db_session, message("/today"))

        assert "nothing" in reply.text.lower()

    def test_upcoming_starts_after_today(self, db_session):
        user = link(db_session, make_user(db_session))
        today = datetime.now(UTC).date()
        add_note(db_session, user, "Today only", today)
        add_note(db_session, user, "Tomorrow", today + timedelta(days=1))
        add_note(db_session, user, "Next month", today + timedelta(days=30))

        reply = bot_commands.handle_update(db_session, message("/upcoming"))

        assert "Tomorrow" in reply.text
        assert "Today only" not in reply.text
        assert "Next month" not in reply.text

    def test_upcoming_says_so_when_empty(self, db_session):
        link(db_session, make_user(db_session))

        reply = bot_commands.handle_update(db_session, message("/upcoming"))

        assert "nothing" in reply.text.lower()

    def test_a_long_list_is_capped_and_counted(self, db_session):
        user = link(db_session, make_user(db_session))
        today = datetime.now(UTC).date()
        for i in range(14):
            add_note(db_session, user, f"note{i}", today)

        reply = bot_commands.handle_update(db_session, message("/today"))

        assert reply.text.count("•") == bot_commands.MAX_LIST_ITEMS
        assert "4" in reply.text.rsplit("\n", 1)[-1]

    def test_a_long_title_is_cut(self, db_session):
        user = link(db_session, make_user(db_session))
        add_note(db_session, user, "x" * 200, datetime.now(UTC).date())

        reply = bot_commands.handle_update(db_session, message("/today"))

        assert "x" * bot_commands.MAX_TITLE_CHARS + "…" in reply.text

    def test_today_follows_the_account_zone(self, db_session):
        # Fixed to a UTC instant where Kiritimati is already on the next day.
        user = make_user(db_session, timezone="Pacific/Kiritimati")
        link(db_session, user)
        now = datetime(2026, 7, 30, 12, 0, tzinfo=UTC)
        add_note(db_session, user, "Their today", date(2026, 7, 31))

        reply = bot_commands.handle_update(db_session, message("/today"), now=now)

        assert "Their today" in reply.text

    @pytest.mark.parametrize("zone", ["Mars/Olympus", "", "/etc/UTC", "Europe/../Europe/Berlin"])
    def test_a_broken_zone_is_reported_not_crashed(self, db_session, zone):
        """ZoneInfo raises ZoneInfoNotFoundError for one of these and ValueError for the rest."""
        user = make_user(db_session)
        link(db_session, user)
        user.timezone = zone
        db_session.commit()

        reply = bot_commands.handle_update(db_session, message("/today"))

        assert "time zone" in reply.text.lower()

    @pytest.mark.parametrize("zone", ["Mars/Olympus", ""])
    def test_upcoming_reports_a_broken_zone_too(self, db_session, zone):
        user = make_user(db_session)
        link(db_session, user)
        user.timezone = zone
        db_session.commit()

        reply = bot_commands.handle_update(db_session, message("/upcoming"))

        assert "time zone" in reply.text.lower()


class TestStatusAndSwitch:
    def test_status_refuses_an_unlinked_chat(self, db_session):
        reply = bot_commands.handle_update(db_session, message("/status"))

        assert "Settings" in reply.text

    def test_status_reports_the_account(self, db_session):
        user = make_user(db_session, timezone="Asia/Bishkek")
        user.reminder_time = time(7, 30)
        db_session.commit()
        link(db_session, user)

        reply = bot_commands.handle_update(db_session, message("/status"))

        assert "alice_tg" in reply.text
        assert "Asia/Bishkek" in reply.text
        assert "07:30" in reply.text
        assert "07:30:00" not in reply.text

    def test_pause_turns_notifications_off(self, db_session):
        user = link(db_session, make_user(db_session))

        bot_commands.handle_update(db_session, message("/pause"))

        db_session.refresh(user)
        assert user.notifications_enabled is False

    def test_resume_turns_them_back_on(self, db_session):
        user = link(db_session, make_user(db_session))
        bot_commands.handle_update(db_session, message("/pause"))

        bot_commands.handle_update(db_session, message("/resume"))

        db_session.refresh(user)
        assert user.notifications_enabled is True

    def test_pause_is_idempotent(self, db_session):
        user = link(db_session, make_user(db_session))
        first = bot_commands.handle_update(db_session, message("/pause"))

        second = bot_commands.handle_update(db_session, message("/pause"))

        assert first.text == second.text
        db_session.refresh(user)
        assert user.notifications_enabled is False

    def test_status_reflects_a_pause(self, db_session):
        link(db_session, make_user(db_session))
        bot_commands.handle_update(db_session, message("/pause"))

        reply = bot_commands.handle_update(db_session, message("/status"))

        assert "off" in reply.text.lower()

    @pytest.mark.parametrize("zone", ["Mars/Olympus", ""])
    def test_status_does_not_claim_reminders_work_with_a_broken_zone(self, db_session, zone):
        """materialize_due drops these users silently, so "Reminders: on" would be a plain lie."""
        user = link(db_session, make_user(db_session))
        user.timezone = zone
        db_session.commit()

        reply = bot_commands.handle_update(db_session, message("/status"))

        assert "Reminders: on" not in reply.text
        assert "time zone" in reply.text.lower()

    def test_a_pause_still_reads_as_a_pause_when_the_zone_is_broken(self, db_session):
        user = link(db_session, make_user(db_session))
        bot_commands.handle_update(db_session, message("/pause"))
        user.timezone = "Mars/Olympus"
        db_session.commit()

        reply = bot_commands.handle_update(db_session, message("/status"))

        assert "Reminders: off" in reply.text


class TestLanguageDrift:
    def test_a_client_language_change_reaches_the_reminders(self, db_session):
        """Answers followed the client immediately; reminders kept the language from link time."""
        user = link(db_session, make_user(db_session), language="en")
        assert user.telegram_language == "en"

        bot_commands.handle_update(db_session, message("/status", language="ru"))

        db_session.refresh(user)
        assert user.telegram_language == "ru"

    def test_an_unchanged_language_is_left_alone(self, db_session):
        user = link(db_session, make_user(db_session), language="ru")

        bot_commands.handle_update(db_session, message("/status", language="ru-RU"))

        db_session.refresh(user)
        assert user.telegram_language == "ru"

    def test_an_unlinked_chat_writes_nothing(self, db_session):
        user = make_user(db_session)

        bot_commands.handle_update(db_session, message("/status", language="ru"))

        db_session.refresh(user)
        assert user.telegram_language is None
