"""Localisation for messages the bot sends.

The app already speaks two languages in the browser, but the bot is not a browser: it has no
session and never sees the `notes_lang` key the UI keeps in localStorage. Telegram, though, sends
the user's client language on every update, so that is what the bot follows — nothing extra for
the user to find, set, and keep in sync with the interface.

English stays the fallback, matching `i18n.jsx`, which resolves a missing key the same way.
"""

from __future__ import annotations

SUPPORTED = ("en", "ru")
DEFAULT = "en"

MESSAGES: dict[str, dict[str, str]] = {
    "en": {
        "start_without_code": (
            "Open Settings in the Notes app and press “Connect Telegram” to link this chat."
        ),
        "link_unknown": "This link is unknown or has expired. Generate a new one in Settings.",
        "link_taken": "This Telegram account is already connected to another Notes account.",
        "linked": "Connected to “{username}”. Reminders will arrive here.",
        "reminder_date": "Date",
        "help_intro": "Here is what I can do:",
        "cmd_today": "What is dated today",
        "cmd_upcoming": "Dated notes for the next 7 days",
        "cmd_status": "How this chat is connected",
        "cmd_pause": "Mute reminders without disconnecting",
        "cmd_resume": "Turn reminders back on",
        "cmd_help": "Show this list",
        "today_header": "Today, {date}",
        "today_empty": "Nothing is dated today.",
        "upcoming_header": "Next 7 days",
        "upcoming_empty": "Nothing dated in the next 7 days.",
        "list_item": "• {title}",
        "list_item_dated": "• {date} — {title}",
        "list_more": "…and {count} more",
        "bad_timezone": "Your time zone ({zone}) is not one I recognise. Fix it in Settings.",
        "status_linked": "Connected as @{username}",
        "status_linked_no_username": "Connected",
        "status_timezone": "Time zone: {zone}",
        "status_time": "Reminder time: {time}",
        "status_on": "Reminders: on",
        "status_off": "Reminders: off",
        "paused": "Reminders muted. /resume turns them back on.",
        "resumed": "Reminders are on.",
    },
    "ru": {
        "start_without_code": (
            "Откройте настройки в приложении Notes и нажмите «Привязать Telegram», "
            "чтобы связать этот чат."
        ),
        "link_unknown": "Ссылка неизвестна или устарела. Сгенерируйте новую в настройках.",
        "link_taken": "Этот Telegram-аккаунт уже привязан к другому аккаунту Notes.",
        "linked": "Готово, аккаунт «{username}» привязан. Напоминания будут приходить сюда.",
        "reminder_date": "Дата",
        "help_intro": "Вот что я умею:",
        "cmd_today": "Что запланировано на сегодня",
        "cmd_upcoming": "Датированные заметки на 7 дней вперёд",
        "cmd_status": "Как подключён этот чат",
        "cmd_pause": "Приглушить напоминания, не отвязываясь",
        "cmd_resume": "Включить напоминания обратно",
        "cmd_help": "Показать этот список",
        "today_header": "Сегодня, {date}",
        "today_empty": "На сегодня заметок нет.",
        "upcoming_header": "Ближайшие 7 дней",
        "upcoming_empty": "На ближайшие 7 дней заметок нет.",
        "list_item": "• {title}",
        "list_item_dated": "• {date} — {title}",
        "list_more": "…и ещё {count}",
        "bad_timezone": "Часовой пояс ({zone}) не распознан. Поправьте его в настройках.",
        "status_linked": "Привязан как @{username}",
        "status_linked_no_username": "Привязан",
        "status_timezone": "Часовой пояс: {zone}",
        "status_time": "Время напоминаний: {time}",
        "status_on": "Напоминания: включены",
        "status_off": "Напоминания: выключены",
        "paused": "Напоминания приглушены. /resume — включить обратно.",
        "resumed": "Напоминания включены.",
    },
}


def resolve_language(language_code: str | None) -> str:
    """Map an IETF tag from Telegram (`ru`, `ru-RU`, `en-GB`) onto a language we actually have."""
    if not language_code:
        return DEFAULT
    primary = language_code.split("-")[0].strip().lower()
    return primary if primary in SUPPORTED else DEFAULT


def t(language: str | None, key: str, **variables: object) -> str:
    catalogue = MESSAGES.get(language or DEFAULT, MESSAGES[DEFAULT])
    return catalogue[key].format(**variables)
