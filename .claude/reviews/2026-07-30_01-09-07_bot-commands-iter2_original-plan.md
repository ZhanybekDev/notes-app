# Bot Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The bot answers `/today`, `/upcoming`, `/status`, `/pause`, `/resume` and `/help`, advertised through Telegram's own command menu in the client's language.

**Architecture:** A new `app/bot_commands.py` becomes the single entry point for an update: it parses the command, routes it, and renders localised text. `telegram_link` is reduced to account work and stops owning prose. The worker hands updates over and sends what comes back.

**Tech Stack:** Python 3.11, SQLAlchemy 2.0, pytest. No new dependencies.

## Global Constraints

- Backend only. `backend/openapi.json` must stay byte-identical — none of this is HTTP.
- Every new string exists in `en` and `ru` in `app/bot_i18n.py`; `test_bot_i18n.py` fails otherwise.
- Plain text replies, never `parse_mode`: the app stores Markdown and real titles break the API.
- Everything except `/start` and `/help` requires a linked chat, and an unlinked chat gets an invitation to link — never data.
- Archived notes and notes without a date never appear.
- At most 10 entries per list, titles cut to 80 characters, `…and N more` when there are more.
- `allowed_updates` stays `["message"]`.
- Run from `/Users/mak/Desktop/amz/notes-app-telegram`; tests are `docker compose exec -T backend pytest`.

**Dates are rendered ISO (`2026-07-30`), departing from the examples in the spec.** The reminder
message already prints `Date: 2026-07-29`, so month names would make the bot inconsistent with
itself, and Russian needs them in the genitive — twenty-four catalogue entries for decoration.

---

### Task 1: The routing seam

**Files:**
- Create: `backend/app/bot_commands.py`
- Modify: `backend/app/telegram_link.py`, `backend/app/bot_i18n.py`, `backend/scripts/worker.py`
- Test: `backend/tests/test_bot_commands.py` (create), `backend/tests/test_telegram_link.py`, `backend/tests/test_worker_polling.py`, `backend/tests/test_bot_i18n.py`

**Interfaces:**
- Produces: `bot_commands.handle_update(db, update) -> BotReply | None` where `BotReply` is a frozen dataclass with `chat_id: int` and `text: str`. Also `bot_commands.COMMANDS`, a tuple of `(name, description_key)` pairs. `telegram_link.redeem_code(db, *, code, chat_id, telegram_username, language) -> tuple[LinkResult, User | None]` with `LinkResult` an enum of `LINKED`, `UNKNOWN_OR_EXPIRED`, `CHAT_TAKEN`. Tasks 2–4 add handlers inside `bot_commands`; Task 4 consumes `COMMANDS`.

`handle_start_command` and `LinkOutcome` disappear. Their prose moves to `bot_commands`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_bot_commands.py
from datetime import UTC, datetime, timedelta

from app import bot_commands
from app.models import User
from app.telegram_link import issue_link_code


def make_user(db, username="alice", **kwargs) -> User:
    user = User(username=username, password_hash="x", timezone="UTC", **kwargs)
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


class TestStart:
    def test_start_without_a_code_explains_how_to_link(self, db_session):
        reply = bot_commands.handle_update(db_session, message("/start"))

        assert "Settings" in reply.text

    def test_valid_code_links_and_confirms(self, db_session):
        user = make_user(db_session)
        code, _ = issue_link_code(db_session, user)

        reply = bot_commands.handle_update(db_session, message(f"/start {code}"))

        assert "alice" in reply.text
        db_session.refresh(user)
        assert user.telegram_chat_id == 100
        assert user.telegram_username == "alice_tg"
        assert user.notifications_enabled is True

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T backend pytest tests/test_bot_commands.py -q --no-cov`
Expected: FAIL — no module named `app.bot_commands`

- [ ] **Step 3: Add the strings to both catalogues**

In `backend/app/bot_i18n.py`, inside the `"en"` dict, add after `"reminder_date"`:

```python
        "help_intro": "Here is what I can do:",
        "cmd_today": "What is dated today",
        "cmd_upcoming": "Dated notes for the next 7 days",
        "cmd_status": "How this chat is connected",
        "cmd_pause": "Mute reminders without disconnecting",
        "cmd_resume": "Turn reminders back on",
        "cmd_help": "Show this list",
```

and inside `"ru"`:

```python
        "help_intro": "Вот что я умею:",
        "cmd_today": "Что запланировано на сегодня",
        "cmd_upcoming": "Датированные заметки на 7 дней вперёд",
        "cmd_status": "Как подключён этот чат",
        "cmd_pause": "Приглушить напоминания, не отвязываясь",
        "cmd_resume": "Включить напоминания обратно",
        "cmd_help": "Показать этот список",
```

- [ ] **Step 4: Reduce `telegram_link` to account work**

Replace the whole `LinkOutcome` dataclass and `handle_start_command` function in
`backend/app/telegram_link.py` with:

```python
class LinkResult(Enum):
    """What redeeming a code did. The wording that reaches the user lives in bot_commands."""

    LINKED = "linked"
    UNKNOWN_OR_EXPIRED = "unknown_or_expired"
    CHAT_TAKEN = "chat_taken"


def redeem_code(
    db: Session,
    *,
    code: str,
    chat_id: int,
    telegram_username: str | None,
    language: str,
) -> tuple[LinkResult, User | None]:
    """Bind a chat to the account that owns `code`."""
    user = db.query(User).filter(User.telegram_link_code == code).one_or_none()
    now = _now()
    if user is None or _expired(user, now):
        return LinkResult.UNKNOWN_OR_EXPIRED, None

    taken_by = (
        db.query(User).filter(User.telegram_chat_id == chat_id, User.id != user.id).one_or_none()
    )
    if taken_by is not None:
        return LinkResult.CHAT_TAKEN, None

    user.telegram_chat_id = chat_id
    user.telegram_username = telegram_username
    user.telegram_language = language
    user.telegram_linked_at = now
    user.telegram_link_code = None
    user.telegram_link_code_expires_at = None
    # Linking with notifications left off would leave the user waiting for messages that
    # never come; unlink() mirrors this by turning them back off.
    user.notifications_enabled = True
    db.commit()
    return LinkResult.LINKED, user


def user_for_chat(db: Session, chat_id: int) -> User | None:
    return db.query(User).filter(User.telegram_chat_id == chat_id).one_or_none()
```

Add `from enum import Enum` to the imports and remove three that lose their last consumer with
`LinkOutcome` and `handle_start_command`: `dataclass`, `Any`, and the whole
`from .bot_i18n import resolve_language, t` line — the module no longer produces prose, which is
the point of the split. Ruff's F401 fails the build otherwise. Keep `issue_link_code`, `unlink`, `parse_start_command`,
`_now` and `_expired` as they are.

- [ ] **Step 5: Write `bot_commands`**

```python
# backend/app/bot_commands.py
"""Everything the bot says, and the routing that decides which of it to say.

The single entry point for an incoming update. `telegram_link` owns the account work and returns
a result; the wording lives here, so there is one place to look for what a user will read.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from . import telegram_link
from .bot_i18n import resolve_language, t
from .telegram_link import LinkResult

logger = logging.getLogger(__name__)

# Advertised through setMyCommands and listed by /help, so the menu and the help cannot disagree.
# `/start` is deliberately absent: it arrives through a deep link, not from the menu.
COMMANDS: tuple[tuple[str, str], ...] = (
    ("today", "cmd_today"),
    ("upcoming", "cmd_upcoming"),
    ("status", "cmd_status"),
    ("pause", "cmd_pause"),
    ("resume", "cmd_resume"),
    ("help", "cmd_help"),
)


@dataclass(frozen=True)
class BotReply:
    chat_id: int
    text: str


def _parse(text: str) -> tuple[str | None, str | None]:
    """Split `/command@bot argument` into its command and its argument."""
    parts = text.strip().split(maxsplit=1)
    if not parts or not parts[0].startswith("/"):
        return None, None
    command = parts[0].split("@")[0].lstrip("/").lower()
    argument = parts[1].strip() if len(parts) > 1 and parts[1].strip() else None
    return command, argument


def _help(language: str) -> str:
    lines = [t(language, "help_intro"), ""]
    lines += [f"/{name} — {t(language, key)}" for name, key in COMMANDS]
    return "\n".join(lines)


def _start(db: Session, chat_id: int, code: str | None, language: str, username: str | None) -> str:
    if code is None:
        return t(language, "start_without_code")
    result, user = telegram_link.redeem_code(
        db, code=code, chat_id=chat_id, telegram_username=username, language=language
    )
    if result is LinkResult.UNKNOWN_OR_EXPIRED:
        return t(language, "link_unknown")
    if result is LinkResult.CHAT_TAKEN:
        return t(language, "link_taken")
    logger.info("linked chat %s", chat_id)
    return t(language, "linked", username=user.username)


def handle_update(db: Session, update: dict[str, Any]) -> BotReply | None:
    """Answer one update, or None when there is nothing to answer."""
    message = update.get("message") or {}
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    if not isinstance(chat_id, int):
        return None

    text = message.get("text")
    # Stickers, photos and forwards are left alone; answering each with a menu would be noise.
    if not isinstance(text, str) or not text.strip():
        return None

    sender = message.get("from") or {}
    language = resolve_language(sender.get("language_code"))
    command, argument = _parse(text)

    if command == "start":
        return BotReply(chat_id, _start(db, chat_id, argument, language, sender.get("username")))
    return BotReply(chat_id, _help(language))
```

- [ ] **Step 6: Point the worker at the router**

In `backend/scripts/worker.py` change the import line

```python
from app import reminders, telegram_link
```

to

```python
from app import bot_commands, reminders
```

Replace the body of the update loop between `db = SessionLocal()` and `finally: db.close()` so the
call reads `outcome = bot_commands.handle_update(db, update)`, and replace the block after the
offset advance with:

```python
        if outcome is None:
            continue
        _reply(client, outcome)
```

Change `_reply` to take the new type:

```python
def _reply(client: TelegramClient, reply: bot_commands.BotReply) -> None:
    """Answer the user, retrying once past a rate limit.

    Worth the retry: a binding is already committed by the time this runs, so without a reply the
    user is linked and has no way to know it.
    """
    try:
        client.send_message(reply.chat_id, reply.text)
        return
    except TelegramRetryAfter as exc:
        time.sleep(exc.seconds)
    except TelegramError:
        logger.exception("failed to reply to chat %s", reply.chat_id)
        return
    try:
        client.send_message(reply.chat_id, reply.text)
    except TelegramError:
        logger.warning("could not answer chat %s", reply.chat_id)
```

The `if outcome.linked: logger.info(...)` line goes away — `bot_commands` logs the binding now.

- [ ] **Step 7: Move the old link tests to the new seam**

In `backend/tests/test_telegram_link.py`, delete every test that exercised `handle_start_command`
and the `start_update` helper, keeping `test_issue_link_code_replaces_previous`,
`test_unlink_clears_binding_and_disables_notifications` and the `parse_start_command` parametrised
test. Rewrite the two survivors that used `handle_start_command` to drive `redeem_code` directly:

```python
def test_issue_link_code_replaces_previous(db_session):
    user = make_user(db_session)
    first, _ = issue_link_code(db_session, user)
    second, _ = issue_link_code(db_session, user)

    assert first != second
    assert redeem_code(
        db_session, code=first, chat_id=100, telegram_username=None, language="en"
    )[0] is LinkResult.UNKNOWN_OR_EXPIRED
    assert redeem_code(
        db_session, code=second, chat_id=100, telegram_username=None, language="en"
    )[0] is LinkResult.LINKED


def test_unlink_clears_binding_and_disables_notifications(db_session):
    user = make_user(db_session)
    code, _ = issue_link_code(db_session, user)
    redeem_code(db_session, code=code, chat_id=100, telegram_username="tg", language="ru")

    unlink(db_session, user)

    db_session.refresh(user)
    assert user.telegram_chat_id is None
    assert user.telegram_username is None
    assert user.telegram_language is None
    assert user.notifications_enabled is False
```

Update the imports in that file to `from app.telegram_link import LinkResult, issue_link_code, parse_start_command, redeem_code, unlink`.

In `backend/tests/test_bot_i18n.py`, replace the import
`from app.telegram_link import handle_start_command, issue_link_code` with
`from app.bot_commands import handle_update` and `from app.telegram_link import issue_link_code`,
drop the `from tests.test_telegram_link import make_user, start_update` import in favour of local
copies of those two helpers, and change every `handle_start_command(db, update)` call to
`handle_update(db, update)` and every `.reply` to `.text`.

In `backend/tests/test_worker_polling.py` there are six references, not four:
`monkeypatch.setattr(worker.telegram_link, "handle_start_command", ...)` on lines 76, 96, 169 and
193, and `real = worker.telegram_link.handle_start_command` on lines 88 and 185. Change every one
of the first kind to `monkeypatch.setattr(worker.bot_commands, "handle_update", ...)` and **both**
of the second to `real = worker.bot_commands.handle_update`. Missing either `real =` leaves a
reference to a function that no longer exists.

- [ ] **Step 8: Run the whole suite**

Run: `docker compose exec -T backend ruff format . && docker compose exec -T backend ruff check --fix . && docker compose exec -T backend pytest -q`
Expected: PASS, coverage above 80%

- [ ] **Step 9: Commit**

```bash
git add backend/app/bot_commands.py backend/app/telegram_link.py backend/app/bot_i18n.py backend/scripts/worker.py backend/tests/
git commit -m "refactor: give the bot a router so it can answer more than /start

handle_start_command replied 'Open Settings…' to any message, because 'no
/start' and '/start without a code' fell through the same branch. While they
were conflated there was nowhere to put a command.

telegram_link now does account work and returns a LinkResult; the wording moved
to a new bot_commands module, which is the single entry point for an update and
already answers /help. The worker hands updates over and sends what comes back.

Messages with no text are ignored rather than answered — replying to every
sticker with a menu is noise."
```

---

### Task 2: `/today` and `/upcoming`

**Files:**
- Modify: `backend/app/bot_commands.py`, `backend/app/bot_i18n.py`
- Test: `backend/tests/test_bot_commands.py`

**Interfaces:**
- Consumes: `BotReply`, `COMMANDS`, `handle_update` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_bot_commands.py`:

```python
from datetime import date, time

from app.models import Note


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

    def test_a_broken_zone_is_reported_not_crashed(self, db_session):
        user = make_user(db_session)
        link(db_session, user)
        user.timezone = "Mars/Olympus"
        db_session.commit()

        reply = bot_commands.handle_update(db_session, message("/today"))

        assert "time zone" in reply.text.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T backend pytest tests/test_bot_commands.py -q --no-cov`
Expected: FAIL — `/today` currently returns the help text

- [ ] **Step 3: Add the strings to both catalogues**

In `"en"`:

```python
        "today_header": "Today, {date}",
        "today_empty": "Nothing is dated today.",
        "upcoming_header": "Next 7 days",
        "upcoming_empty": "Nothing dated in the next 7 days.",
        "list_item": "• {title}",
        "list_item_dated": "• {date} — {title}",
        "list_more": "…and {count} more",
        "bad_timezone": "Your time zone ({zone}) is not one I recognise. Fix it in Settings.",
```

In `"ru"`:

```python
        "today_header": "Сегодня, {date}",
        "today_empty": "На сегодня заметок нет.",
        "upcoming_header": "Ближайшие 7 дней",
        "upcoming_empty": "На ближайшие 7 дней заметок нет.",
        "list_item": "• {title}",
        "list_item_dated": "• {date} — {title}",
        "list_more": "…и ещё {count}",
        "bad_timezone": "Часовой пояс ({zone}) не распознан. Поправьте его в настройках.",
```

- [ ] **Step 4: Implement the listings**

Add to the imports in `backend/app/bot_commands.py`:

```python
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .models import Note, User
```

Add the constants under `COMMANDS`:

```python
MAX_LIST_ITEMS = 10
MAX_TITLE_CHARS = 80
UPCOMING_DAYS = 7
```

Add the helpers and handlers above `handle_update`:

```python
def _today_for(user: User, now: datetime) -> date:
    """Today from the account's point of view, which is the only one that matters here."""
    return now.astimezone(ZoneInfo(user.timezone)).date()


def _titles(db: Session, user: User, first: date, last: date) -> tuple[list[Note], int]:
    query = (
        db.query(Note)
        .filter(
            Note.user_id == user.id,
            Note.archived_at.is_(None),
            Note.note_date.is_not(None),
            Note.note_date >= first,
            Note.note_date <= last,
        )
        .order_by(Note.note_date, Note.id)
    )
    return query.limit(MAX_LIST_ITEMS).all(), query.count()


def _cut(title: str) -> str:
    return title if len(title) <= MAX_TITLE_CHARS else title[:MAX_TITLE_CHARS] + "…"


def _render(language: str, header: str, notes: list[Note], total: int, *, dated: bool) -> str:
    lines = [header, ""]
    for note in notes:
        lines.append(
            t(language, "list_item_dated", date=note.note_date.isoformat(), title=_cut(note.title))
            if dated
            else t(language, "list_item", title=_cut(note.title))
        )
    if total > len(notes):
        lines.append(t(language, "list_more", count=total - len(notes)))
    return "\n".join(lines)


def _today(db: Session, user: User, language: str, now: datetime) -> str:
    day = _today_for(user, now)
    notes, total = _titles(db, user, day, day)
    if not notes:
        return t(language, "today_empty")
    header = t(language, "today_header", date=day.isoformat())
    return _render(language, header, notes, total, dated=False)


def _upcoming(db: Session, user: User, language: str, now: datetime) -> str:
    day = _today_for(user, now)
    notes, total = _titles(db, user, day + timedelta(days=1), day + timedelta(days=UPCOMING_DAYS))
    if not notes:
        return t(language, "upcoming_empty")
    return _render(language, t(language, "upcoming_header"), notes, total, dated=True)
```

Give `handle_update` a `now` parameter and the linked-chat routing. Replace its signature and its
final `return` with:

```python
def handle_update(
    db: Session, update: dict[str, Any], now: datetime | None = None
) -> BotReply | None:
    """Answer one update, or None when there is nothing to answer."""
    now = now or datetime.now(UTC)
```

and, in place of the closing `return BotReply(chat_id, _help(language))`:

```python
    if command == "start":
        return BotReply(chat_id, _start(db, chat_id, argument, language, sender.get("username")))
    if command not in dict(COMMANDS) or command == "help":
        return BotReply(chat_id, _help(language))

    user = telegram_link.user_for_chat(db, chat_id)
    if user is None:
        return BotReply(chat_id, t(language, "start_without_code"))

    try:
        if command == "today":
            return BotReply(chat_id, _today(db, user, language, now))
        if command == "upcoming":
            return BotReply(chat_id, _upcoming(db, user, language, now))
    except ZoneInfoNotFoundError:
        # Only reachable if the column was edited outside the API, which validates it. Saying so
        # beats letting it escape into the polling loop, which does not catch this.
        return BotReply(chat_id, t(language, "bad_timezone", zone=user.timezone))
    return BotReply(chat_id, _help(language))
```

- [ ] **Step 5: Run the tests**

Run: `docker compose exec -T backend pytest tests/test_bot_commands.py -q --no-cov`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/bot_commands.py backend/app/bot_i18n.py backend/tests/test_bot_commands.py
git commit -m "feat: /today and /upcoming

Answers 'what is on my plate' where the reminders arrive, rather than sending
the user to the browser for it.

Today is taken in the account's zone, not the server's — the two disagree for
most of the day for anyone far enough east or west, and the bot would otherwise
contradict the reminder it just sent. An unrecognised zone is reported rather
than raised: it can only come from an edit outside the API, and the polling loop
does not catch that exception.

Lists are capped at ten with a count of the rest, and titles cut at eighty, so a
busy week cannot push a message past what Telegram accepts."
```

---

### Task 3: `/status`, `/pause` and `/resume`

**Files:**
- Modify: `backend/app/bot_commands.py`, `backend/app/bot_i18n.py`
- Test: `backend/tests/test_bot_commands.py`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Extend the file's top imports to `from datetime import UTC, date, datetime, time, timedelta`, then
append:

```python
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
```

And, in `backend/tests/test_worker_tick.py`, append a test proving the switch reaches delivery:

Extend that file's top import to `from app import bot_commands, reminders`, then:

```python
def test_pause_from_the_bot_stops_delivery(wired):
    note = seed(wired)
    user = wired.get(User, note.user_id)  # seed already binds this user to chat 100
    bot_commands.handle_update(
        wired,
        {
            "update_id": 1,
            "message": {"chat": {"id": 100}, "from": {"language_code": "en"}, "text": "/pause"},
        },
    )
    client = FakeClient()

    assert worker.tick(client, DUE) == 0
    assert client.sent == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T backend pytest tests/test_bot_commands.py tests/test_worker_tick.py -q --no-cov`
Expected: FAIL — `/status` returns the help text

- [ ] **Step 3: Add the strings to both catalogues**

In `"en"`:

```python
        "status_linked": "Connected as @{username}",
        "status_linked_no_username": "Connected",
        "status_timezone": "Time zone: {zone}",
        "status_time": "Reminder time: {time}",
        "status_on": "Reminders: on",
        "status_off": "Reminders: off",
        "paused": "Reminders muted. /resume turns them back on.",
        "resumed": "Reminders are on.",
```

In `"ru"`:

```python
        "status_linked": "Привязан как @{username}",
        "status_linked_no_username": "Привязан",
        "status_timezone": "Часовой пояс: {zone}",
        "status_time": "Время напоминаний: {time}",
        "status_on": "Напоминания: включены",
        "status_off": "Напоминания: выключены",
        "paused": "Напоминания приглушены. /resume — включить обратно.",
        "resumed": "Напоминания включены.",
```

- [ ] **Step 4: Implement the three handlers**

Add above `handle_update` in `backend/app/bot_commands.py`:

```python
def _status(user: User, language: str) -> str:
    lines = [
        t(language, "status_linked", username=user.telegram_username)
        if user.telegram_username
        else t(language, "status_linked_no_username"),
        t(language, "status_timezone", zone=user.timezone),
        t(language, "status_time", time=user.reminder_time.strftime("%H:%M")),
        t(language, "status_on" if user.notifications_enabled else "status_off"),
    ]
    return "\n".join(lines)


def _switch(db: Session, user: User, language: str, *, on: bool) -> str:
    """Idempotent on purpose: nothing useful distinguishes pausing a silent account."""
    user.notifications_enabled = on
    db.commit()
    return t(language, "resumed" if on else "paused")
```

Extend the routing inside the `try` block, after the `upcoming` branch:

```python
        if command == "status":
            return BotReply(chat_id, _status(user, language))
        if command == "pause":
            return BotReply(chat_id, _switch(db, user, language, on=False))
        if command == "resume":
            return BotReply(chat_id, _switch(db, user, language, on=True))
```

- [ ] **Step 5: Run the tests**

Run: `docker compose exec -T backend pytest -q`
Expected: PASS, coverage above 80%

- [ ] **Step 6: Commit**

```bash
git add backend/app/bot_commands.py backend/app/bot_i18n.py backend/tests/test_bot_commands.py backend/tests/test_worker_tick.py
git commit -m "feat: /status, /pause and /resume

The switch belongs where the messages arrive. /pause writes the same flag the
web toggle writes, so cancel_stale retires what was scheduled and the next
materialisation pass brings it back on /resume — no second mechanism.

Both are idempotent. Pausing an already-silent account answers the same way;
there is nothing useful to say about the difference and a special case would
only be another branch to get wrong.

The pause is tested against the outbox rather than the reply text: a reassuring
sentence is not evidence that a reminder stayed home."
```

---

### Task 4: Advertise the menu

**Files:**
- Modify: `backend/app/telegram.py`, `backend/scripts/worker.py`
- Test: `backend/tests/test_telegram_client.py`, `backend/tests/test_worker_polling.py`

**Interfaces:**
- Consumes: `bot_commands.COMMANDS` from Task 1.
- Produces: `HttpTelegramClient.set_my_commands(commands, language_code=None)`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_telegram_client.py`:

```python
def test_set_my_commands_sends_the_language():
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        return httpx.Response(200, json={"ok": True, "result": True})

    make_client(handler).set_my_commands(
        [{"command": "today", "description": "What is dated today"}], language_code="en"
    )

    assert captured["language_code"] == "en"
    assert captured["commands"][0]["command"] == "today"


def test_set_my_commands_omits_the_language_when_absent():
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        return httpx.Response(200, json={"ok": True, "result": True})

    make_client(handler).set_my_commands([{"command": "today", "description": "x"}])

    assert "language_code" not in captured
```

And append to `backend/tests/test_worker_polling.py`:

```python
class TestMenuRegistration:
    # No fixture: these drive the client only, and building a schema for them would be waste.
    def test_registers_every_language(self):
        from app.bot_i18n import SUPPORTED

        calls: list[str | None] = []

        class Client:
            def set_my_commands(self, commands, language_code=None):
                calls.append(language_code)

        worker.register_commands(Client())

        assert sorted(calls) == sorted(SUPPORTED)

    def test_a_failed_registration_does_not_stop_the_worker(self):
        class Client:
            def set_my_commands(self, commands, language_code=None):
                raise TelegramError("nope")

        worker.register_commands(Client())  # must not raise
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T backend pytest tests/test_telegram_client.py tests/test_worker_polling.py -q --no-cov`
Expected: FAIL — no attribute `set_my_commands`, no attribute `register_commands`

- [ ] **Step 3: Add the client method**

In `backend/app/telegram.py`, add to the `TelegramClient` Protocol:

```python
    def set_my_commands(
        self, commands: list[dict[str, str]], language_code: str | None = None
    ) -> None: ...
```

and to `HttpTelegramClient`:

```python
    def set_my_commands(
        self, commands: list[dict[str, str]], language_code: str | None = None
    ) -> None:
        payload: dict[str, Any] = {"commands": commands}
        if language_code is not None:
            payload["language_code"] = language_code
        self._call("setMyCommands", payload, read_timeout=30.0)
```

- [ ] **Step 4: Register at startup**

In `backend/scripts/worker.py` add the import `from app.bot_i18n import SUPPORTED, t` and:

```python
def register_commands(client: TelegramClient) -> None:
    """Publish the command menu, once per language.

    Advisory: a bot that cannot advertise its menu still answers when asked, so a failure here is
    logged and the loop starts anyway.
    """
    for language in SUPPORTED:
        commands = [
            {"command": name, "description": t(language, key)}
            for name, key in bot_commands.COMMANDS
        ]
        try:
            client.set_my_commands(commands, language_code=language)
        except TelegramError:
            logger.warning("could not publish the %s command menu", language)
```

Call it in `run()` directly after `client = build_client()` and before the "worker started" log line.

- [ ] **Step 5: Run the whole suite and the gates**

Run: `docker compose exec -T backend ruff format . && docker compose exec -T backend ruff check . && make lint && make test`
Expected: PASS everywhere

- [ ] **Step 6: Bring the architecture doc back in line**

`docs/architecture.md` enumerates the backend packages and will be wrong the moment `bot_commands`
exists. Under the backend packages list, add:

```markdown
- **`app/bot_commands.py`** — the single entry point for an incoming update: parses the command,
  routes it and renders the reply. Everything the bot says lives here, so there is one place to
  look for what a user will read.
```

and change the `app/telegram_link.py` bullet to end with "Returns a `LinkResult`; the wording that
reaches the user belongs to `bot_commands`." In the backend layout tree, add
`│   ├── bot_commands.py  command routing and replies` next to `bot_i18n.py`.

Add the six commands to the Cross-cutting concerns section, after the i18n bullet:

```markdown
- **Bot commands** — `/today`, `/upcoming`, `/status`, `/pause`, `/resume`, `/help`, published with
  `setMyCommands` per language. Everything but `/start` and `/help` needs a linked chat; an
  unlinked one is invited to link rather than told anything about an account.
```

- [ ] **Step 7: Verify openapi did not move**

Run: `git status --short backend/openapi.json`
Expected: no output — none of this is HTTP.

- [ ] **Step 8: Commit**

```bash
git add backend/app/telegram.py backend/scripts/worker.py backend/tests/test_telegram_client.py backend/tests/test_worker_polling.py docs/architecture.md
git commit -m "feat: publish the command menu in both languages

setMyCommands takes a language_code, so the menu button shows Russian
descriptions to a Russian client and English to everyone else — the same rule
the bot's messages already follow.

Registration is advisory. A bot that cannot advertise its menu still answers
when asked, so a failure is logged and the loop starts regardless."
```

---

## Verification after the last task

```bash
make lint
make test
docker compose restart worker
docker compose logs worker --tail 5
```

Then talk to the bot: press the menu button and check the six commands appear with descriptions,
then send `/today`, `/upcoming`, `/status`, `/pause`, `/status` again, `/resume`.
