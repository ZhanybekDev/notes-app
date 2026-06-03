"""Thin Telegram Bot API client over httpx.

Stays dependency-light (no python-telegram-bot): the feature only needs three
methods. When ``TELEGRAM_BOT_TOKEN`` is unset, :func:`get_client` returns ``None``
and the whole feature degrades gracefully - the app still boots and ``make up``
works without a token.
"""

from __future__ import annotations

import httpx

from .config import settings

API_BASE = "https://api.telegram.org"


class TelegramError(Exception):
    """Raised when the Bot API returns a non-ok response or transport fails."""


class TelegramClient:
    def __init__(self, token: str, *, base_url: str = API_BASE, timeout: float = 10.0) -> None:
        self.token = token
        self.base_url = base_url
        self.timeout = timeout

    def _call(self, method: str, params: dict | None = None, *, timeout: float | None = None):
        url = f"{self.base_url}/bot{self.token}/{method}"
        try:
            resp = httpx.post(url, json=params or {}, timeout=timeout or self.timeout)
        except httpx.HTTPError as exc:  # transport-level: caller may retry
            raise TelegramError(f"telegram {method} transport error: {exc}") from exc
        if resp.status_code >= 500:
            raise TelegramError(f"telegram {method} http {resp.status_code}")
        data = resp.json()
        if not data.get("ok"):
            raise TelegramError(f"telegram {method} failed: {data.get('description')}")
        return data["result"]

    def get_me(self) -> dict:
        return self._call("getMe")

    def send_message(self, chat_id: str, text: str) -> dict:
        return self._call("sendMessage", {"chat_id": chat_id, "text": text})

    def get_updates(self, offset: int | None = None, timeout: int = 30) -> list[dict]:
        params: dict = {"timeout": timeout}
        if offset is not None:
            params["offset"] = offset
        return self._call("getUpdates", params, timeout=timeout + 10)


def get_client() -> TelegramClient | None:
    """Return a client, or ``None`` when no bot token is configured."""
    if not settings.telegram_bot_token:
        return None
    return TelegramClient(settings.telegram_bot_token)


def build_link_url(username: str, code: str) -> str:
    return f"https://t.me/{username}?start={code}"


def resolve_bot_username() -> str | None:
    """Bot username for deep links: prefer the configured value, else ask getMe."""
    if settings.telegram_bot_username:
        return settings.telegram_bot_username
    client = get_client()
    if client is None:
        return None
    try:
        return client.get_me().get("username")
    except TelegramError:
        return None
