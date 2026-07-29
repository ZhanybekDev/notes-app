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
