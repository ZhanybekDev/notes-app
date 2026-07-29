import json

import httpx
import pytest

from app.telegram import (
    HttpTelegramClient,
    TelegramError,
    TelegramNotConfigured,
    TelegramRetryAfter,
)


def make_client(handler) -> HttpTelegramClient:
    return HttpTelegramClient(
        "secret-token", client=httpx.Client(transport=httpx.MockTransport(handler))
    )


def test_send_message_success():
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"ok": True, "result": {"message_id": 1}})

    make_client(handler).send_message(42, "hello")

    assert seen["body"] == {"chat_id": 42, "text": "hello"}
    assert str(seen["url"]).endswith("/sendMessage")


def test_send_message_never_sets_parse_mode():
    # Notes are Markdown; a parse_mode would make the API reject unbalanced * _ [ ` with 400.
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        return httpx.Response(200, json={"ok": True, "result": {}})

    make_client(handler).send_message(1, "**not** _valid_ [markdown")

    assert "parse_mode" not in captured


def test_rate_limit_raises_retry_after():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429,
            json={
                "ok": False,
                "description": "Too Many Requests",
                "parameters": {"retry_after": 7},
            },
        )

    with pytest.raises(TelegramRetryAfter) as exc:
        make_client(handler).send_message(1, "x")

    assert exc.value.seconds == 7


def test_server_error_raises_telegram_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"ok": False, "description": "Internal"})

    with pytest.raises(TelegramError):
        make_client(handler).send_message(1, "x")


def test_network_failure_does_not_leak_token():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out")

    with pytest.raises(TelegramError) as exc:
        make_client(handler).send_message(1, "x")

    assert "secret-token" not in str(exc.value)


def test_get_updates_passes_offset_and_returns_list():
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        return httpx.Response(200, json={"ok": True, "result": [{"update_id": 5}]})

    updates = make_client(handler).get_updates(11, 25)

    assert captured["offset"] == 11
    assert captured["timeout"] == 25
    assert updates == [{"update_id": 5}]


def test_get_updates_omits_offset_when_none():
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        return httpx.Response(200, json={"ok": True, "result": []})

    make_client(handler).get_updates(None, 25)

    assert "offset" not in captured


def test_empty_token_is_rejected():
    with pytest.raises(TelegramNotConfigured):
        HttpTelegramClient("")


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
