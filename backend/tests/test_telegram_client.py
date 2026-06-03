import os

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test-secret-with-at-least-32-characters")

import httpx
import pytest

from app import telegram
from app.config import settings
from app.telegram import (
    TelegramClient,
    TelegramError,
    build_link_url,
    get_client,
    resolve_bot_username,
)


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload


def test_build_link_url():
    assert build_link_url("mybot", "code1") == "https://t.me/mybot?start=code1"


def test_get_client_none_without_token(monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", None, raising=False)
    assert get_client() is None


def test_get_client_with_token(monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", "abc", raising=False)
    assert isinstance(get_client(), TelegramClient)


def test_send_message_ok(monkeypatch):
    captured = {}

    def fake_post(url, json, timeout):
        captured["url"] = url
        captured["json"] = json
        return FakeResponse({"ok": True, "result": {"message_id": 1}})

    monkeypatch.setattr(httpx, "post", fake_post)
    client = TelegramClient("tok", base_url="https://api.telegram.org")
    result = client.send_message("42", "hi")
    assert result == {"message_id": 1}
    assert captured["url"] == "https://api.telegram.org/bottok/sendMessage"
    assert captured["json"] == {"chat_id": "42", "text": "hi"}


def test_get_updates_passes_offset(monkeypatch):
    captured = {}

    def fake_post(url, json, timeout):
        captured["json"] = json
        return FakeResponse({"ok": True, "result": []})

    monkeypatch.setattr(httpx, "post", fake_post)
    TelegramClient("tok").get_updates(offset=7, timeout=1)
    assert captured["json"] == {"timeout": 1, "offset": 7}


def test_api_error_on_not_ok(monkeypatch):
    monkeypatch.setattr(
        httpx, "post", lambda *a, **k: FakeResponse({"ok": False, "description": "nope"})
    )
    with pytest.raises(TelegramError, match="nope"):
        TelegramClient("tok").get_me()


def test_api_error_on_5xx(monkeypatch):
    monkeypatch.setattr(httpx, "post", lambda *a, **k: FakeResponse({}, status_code=502))
    with pytest.raises(TelegramError, match="http 502"):
        TelegramClient("tok").get_me()


def test_transport_error_wrapped(monkeypatch):
    def boom(*a, **k):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(httpx, "post", boom)
    with pytest.raises(TelegramError, match="transport error"):
        TelegramClient("tok").send_message("1", "x")


def test_resolve_bot_username_prefers_config(monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_username", "configured_bot", raising=False)
    assert resolve_bot_username() == "configured_bot"


def test_resolve_bot_username_via_get_me(monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_username", None, raising=False)

    class FakeClient:
        def get_me(self):
            return {"username": "from_api_bot"}

    monkeypatch.setattr(telegram, "get_client", lambda: FakeClient())
    assert resolve_bot_username() == "from_api_bot"


def test_resolve_bot_username_none_without_token(monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_username", None, raising=False)
    monkeypatch.setattr(telegram, "get_client", lambda: None)
    assert resolve_bot_username() is None
