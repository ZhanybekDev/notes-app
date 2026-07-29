"""Minimal synchronous Telegram Bot API client.

Only two methods are needed (`getUpdates`, `sendMessage`), so this talks to the HTTP API
directly instead of pulling in an async bot framework: `httpx` is already a dependency and
the rest of the codebase is synchronous.
"""

from __future__ import annotations

from typing import Any, Protocol

import httpx

from .config import settings

API_ROOT = "https://api.telegram.org"


class TelegramError(RuntimeError):
    """Bot API returned a failure that is not worth special-casing."""


class TelegramNotConfigured(TelegramError):
    """No bot token is configured; the caller must stay idle."""


class TelegramRetryAfter(TelegramError):
    """Bot API asked us to back off. `seconds` must be respected literally."""

    def __init__(self, seconds: int) -> None:
        super().__init__(f"rate limited, retry after {seconds}s")
        self.seconds = seconds


class TelegramClient(Protocol):
    """Seam that lets the worker and tests swap the real API for a stub."""

    def get_updates(self, offset: int | None, timeout: int) -> list[dict[str, Any]]: ...

    def send_message(self, chat_id: int, text: str) -> None: ...


class HttpTelegramClient:
    def __init__(self, token: str, *, api_root: str = API_ROOT, client: httpx.Client | None = None):
        if not token:
            raise TelegramNotConfigured("TELEGRAM_BOT_TOKEN is not set")
        self._token = token
        self._api_root = api_root
        self._client = client or httpx.Client(timeout=httpx.Timeout(60.0))

    def _call(self, method: str, payload: dict[str, Any], *, read_timeout: float) -> Any:
        # The token lives in the URL, so no error path may echo the URL back.
        url = f"{self._api_root}/bot{self._token}/{method}"
        try:
            response = self._client.post(url, json=payload, timeout=read_timeout)
        except httpx.HTTPError as exc:
            raise TelegramError(f"{method} failed: {type(exc).__name__}") from None

        if response.status_code == httpx.codes.TOO_MANY_REQUESTS:
            body = self._safe_json(response)
            retry_after = int(body.get("parameters", {}).get("retry_after", 1))
            raise TelegramRetryAfter(retry_after)

        body = self._safe_json(response)
        if not response.is_success or not body.get("ok"):
            description = body.get("description", f"HTTP {response.status_code}")
            raise TelegramError(f"{method} failed: {description}")
        return body.get("result")

    @staticmethod
    def _safe_json(response: httpx.Response) -> dict[str, Any]:
        try:
            body = response.json()
        except ValueError:
            return {}
        return body if isinstance(body, dict) else {}

    def get_updates(self, offset: int | None, timeout: int) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {"timeout": timeout, "allowed_updates": ["message"]}
        if offset is not None:
            payload["offset"] = offset
        result = self._call("getUpdates", payload, read_timeout=timeout + 10)
        return result if isinstance(result, list) else []

    def send_message(self, chat_id: int, text: str) -> None:
        # parse_mode is deliberately omitted: notes are Markdown documents, so their text
        # routinely contains unbalanced *, _, [ and backticks. With a parse_mode set the API
        # rejects those with HTTP 400 — the feature would break on real notes only.
        self._call("sendMessage", {"chat_id": chat_id, "text": text}, read_timeout=30.0)


def build_client() -> HttpTelegramClient:
    if not settings.bot_configured:
        raise TelegramNotConfigured("TELEGRAM_BOT_TOKEN / TELEGRAM_BOT_USERNAME are not set")
    return HttpTelegramClient(settings.telegram_bot_token or "")
