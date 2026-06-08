from datetime import UTC, date, datetime, timedelta

import httpx

from app.bot_worker import process_update, send_due_once
from app.models import Note, User
from app.reminders import send_due_reminders_once
from app.telegram_bot import TelegramBotClient


def _create_linked_user(db, *, username="telegram-user", chat_id="777") -> User:
    user = User(
        username=username,
        password_hash="hash",
        telegram_chat_id=chat_id,
        telegram_username="demo_user",
        telegram_notifications_enabled=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


class FakeBot:
    enabled = True

    def __init__(self):
        self.messages: list[tuple[str, str]] = []

    def send_message(self, chat_id, text):
        self.messages.append((str(chat_id), text))
        return {"ok": True}


def test_process_start_code_links_account(client):
    now = datetime(2026, 6, 2, 12, 0, tzinfo=UTC)
    with client.session_factory() as db:
        user = User(
            username="pending-link",
            password_hash="hash",
            telegram_link_code="ABCD1234",
            telegram_link_code_expires_at=now + timedelta(minutes=5),
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        bot = FakeBot()
        linked = process_update(
            db,
            bot,
            {
                "message": {
                    "text": "/start abcd1234",
                    "chat": {"id": 9999},
                    "from": {"username": "telegram_demo"},
                }
            },
            now=now,
        )

        db.refresh(user)
        assert linked is True
        assert user.telegram_chat_id == "9999"
        assert user.telegram_username == "telegram_demo"
        assert user.telegram_notifications_enabled is True
        assert user.telegram_link_code is None
        assert user.telegram_link_code_expires_at is None
        assert bot.messages[-1][0] == "9999"
        assert "Date reminders are now enabled" in bot.messages[-1][1]


def test_process_start_code_rejects_expired_code(client):
    now = datetime(2026, 6, 2, 12, 0, tzinfo=UTC)
    with client.session_factory() as db:
        user = User(
            username="expired-link",
            password_hash="hash",
            telegram_link_code="EXPIRED1",
            telegram_link_code_expires_at=now - timedelta(minutes=1),
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        bot = FakeBot()
        linked = process_update(
            db,
            bot,
            {
                "message": {
                    "text": "/start expired1",
                    "chat": {"id": 1111},
                    "from": {"username": "telegram_demo"},
                }
            },
            now=now,
        )

        db.refresh(user)
        assert linked is False
        assert user.telegram_chat_id is None
        assert user.telegram_link_code is None
        assert "invalid or expired" in bot.messages[-1][1].lower()


def test_due_reminder_is_sent_once_and_marked(client):
    now = datetime(2026, 6, 2, 9, 30, tzinfo=UTC)
    with client.session_factory() as db:
        user = _create_linked_user(db)
        note = Note(
            user_id=user.id,
            title="Telegram smoke test",
            content="This should arrive once.",
            tags=[],
            note_date=date(2026, 6, 2),
        )
        db.add(note)
        db.commit()
        db.refresh(note)

        bot = FakeBot()
        first = send_due_reminders_once(db, bot, reminder_timezone="UTC", now=now)
        db.refresh(note)
        second = send_due_reminders_once(db, bot, reminder_timezone="UTC", now=now)
        db.refresh(note)

        assert first == 1
        assert second == 0
        assert len(bot.messages) == 1
        assert note.reminder_sent_for_date == date(2026, 6, 2)
        assert note.reminder_sent_at.replace(tzinfo=UTC) == now


def test_archived_notes_are_excluded_from_due_selection(client):
    now = datetime(2026, 6, 2, 9, 30, tzinfo=UTC)
    with client.session_factory() as db:
        user = _create_linked_user(db, username="archive-user", chat_id="888")
        active = Note(
            user_id=user.id,
            title="active",
            content="send me",
            tags=[],
            note_date=date(2026, 6, 2),
        )
        archived = Note(
            user_id=user.id,
            title="archived",
            content="do not send",
            tags=[],
            note_date=date(2026, 6, 2),
            archived_at=now,
        )
        db.add_all([active, archived])
        db.commit()
        db.refresh(active)
        db.refresh(archived)

        bot = FakeBot()
        sent = send_due_reminders_once(db, bot, reminder_timezone="UTC", now=now)
        db.refresh(active)
        db.refresh(archived)

        assert sent == 1
        assert len(bot.messages) == 1
        assert active.reminder_sent_for_date == date(2026, 6, 2)
        assert archived.reminder_sent_for_date is None


def test_send_due_once_is_noop_without_token(client):
    sent = send_due_once(session_factory=client.session_factory, bot=TelegramBotClient(None))
    assert sent == 0


def test_telegram_bot_client_uses_httpx_transport():
    seen = []

    def handler(request):
        seen.append((request.method, request.url.path, str(request.url.query)))
        if request.url.path.endswith("/getUpdates"):
            return httpx.Response(200, json={"ok": True, "result": [{"update_id": 7}]})
        return httpx.Response(200, json={"ok": True, "result": {"message_id": 1}})

    with TelegramBotClient("token", transport=httpx.MockTransport(handler)) as bot:
        updates = bot.get_updates(offset=5, timeout=10)
        result = bot.send_message("42", "hello")

    assert updates == [{"update_id": 7}]
    assert result == {"message_id": 1}
    assert seen[0][0] == "GET"
    assert seen[0][1].endswith("/getUpdates")
    assert "offset=5" in seen[0][2]
    assert seen[1][0] == "POST"
    assert seen[1][1].endswith("/sendMessage")
