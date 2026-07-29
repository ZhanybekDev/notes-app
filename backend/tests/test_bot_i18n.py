import pytest

from app import reminders
from app.bot_i18n import DEFAULT, MESSAGES, SUPPORTED, resolve_language, t
from app.models import Note
from app.telegram_link import handle_start_command, issue_link_code
from tests.test_telegram_link import make_user, start_update


def test_every_language_carries_the_same_keys():
    """The frontend has no such test and DoD asks for parity; the bot catalogue gets one."""
    reference = set(MESSAGES[DEFAULT])

    for language in SUPPORTED:
        assert set(MESSAGES[language]) == reference, f"{language} diverges from {DEFAULT}"


def test_no_message_is_left_blank():
    blank = [
        f"{lang}.{key}"
        for lang, catalogue in MESSAGES.items()
        for key, value in catalogue.items()
        if not value.strip()
    ]

    assert blank == []


@pytest.mark.parametrize(
    ("code", "expected"),
    [
        ("ru", "ru"),
        ("ru-RU", "ru"),
        ("RU", "ru"),
        ("en", "en"),
        ("en-GB", "en"),
        ("de", "en"),
        ("", "en"),
        (None, "en"),
    ],
)
def test_resolve_language(code, expected):
    assert resolve_language(code) == expected


def test_unknown_language_falls_back_rather_than_raising():
    assert t("de", "link_unknown") == MESSAGES["en"]["link_unknown"]


class TestLinkRepliesFollowTheClient:
    def _reply(self, db, language_code, code="nope"):
        update = start_update(code)
        update["message"]["from"]["language_code"] = language_code
        return handle_start_command(db, update).reply

    def test_russian_client_gets_russian(self, db_session):
        assert "устарела" in self._reply(db_session, "ru-RU")

    def test_english_client_gets_english(self, db_session):
        assert "expired" in self._reply(db_session, "en")

    def test_missing_language_code_falls_back_to_english(self, db_session):
        update = start_update("nope")
        update["message"]["from"].pop("language_code", None)

        assert "expired" in handle_start_command(db_session, update).reply

    def test_confirmation_is_localised_and_the_language_is_remembered(self, db_session):
        user = make_user(db_session)
        code, _ = issue_link_code(db_session, user)
        update = start_update(code)
        update["message"]["from"]["language_code"] = "ru"

        outcome = handle_start_command(db_session, update)

        assert "Готово" in outcome.reply
        db_session.refresh(user)
        assert user.telegram_language == "ru"

    def test_unlinking_forgets_the_language(self, db_session):
        from app.telegram_link import unlink

        user = make_user(db_session)
        code, _ = issue_link_code(db_session, user)
        update = start_update(code)
        update["message"]["from"]["language_code"] = "ru"
        handle_start_command(db_session, update)

        unlink(db_session, user)

        db_session.refresh(user)
        assert user.telegram_language is None


class TestReminderText:
    def _note(self):
        from datetime import date

        return Note(title="Стендап", content="повестка", tags=[], note_date=date(2026, 8, 1))

    def test_russian(self):
        assert "Дата: 2026-08-01" in reminders.render_message(self._note(), "ru")

    def test_english(self):
        assert "Date: 2026-08-01" in reminders.render_message(self._note(), "en")

    def test_defaults_to_english_for_accounts_linked_before_the_column_existed(self):
        assert "Date: 2026-08-01" in reminders.render_message(self._note(), None)
