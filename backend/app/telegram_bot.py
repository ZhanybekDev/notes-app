from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import httpx


class TelegramBotClient:
    def __init__(
        self,
        token: str | None,
        *,
        timeout_seconds: int = 30,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.enabled = bool(token)
        self._client: httpx.Client | None = None
        if self.enabled:
            self._client = httpx.Client(
                base_url=f"https://api.telegram.org/bot{token}/",
                timeout=timeout_seconds + 5,
                transport=transport,
            )

    def close(self) -> None:
        if self._client is not None:
            self._client.close()

    def get_updates(self, *, offset: int | None = None, timeout: int = 30) -> list[dict[str, Any]]:
        if self._client is None:
            return []

        payload: dict[str, Any] = {"timeout": timeout}
        if offset is not None:
            payload["offset"] = offset

        response = self._client.get("getUpdates", params=payload)
        data = self._decode_response(response)
        result = data.get("result", [])
        if not isinstance(result, Sequence):
            raise RuntimeError("Telegram getUpdates response is malformed")
        return [item for item in result if isinstance(item, dict)]

    def send_message(self, chat_id: str, text: str) -> dict[str, Any] | None:
        if self._client is None:
            return None
        response = self._client.post("sendMessage", json={"chat_id": chat_id, "text": text})
        data = self._decode_response(response)
        result = data.get("result")
        if result is None:
            raise RuntimeError("Telegram sendMessage response is malformed")
        if not isinstance(result, dict):
            raise RuntimeError("Telegram sendMessage result must be an object")
        return result

    @staticmethod
    def _decode_response(response: httpx.Response) -> dict[str, Any]:
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            raise RuntimeError("Telegram response must be a JSON object")
        if not data.get("ok"):
            description = data.get("description") or "Telegram API request failed"
            raise RuntimeError(str(description))
        return data

    def __enter__(self) -> TelegramBotClient:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()
