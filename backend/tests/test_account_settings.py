import pytest

from app.config import settings


def register_and_login(client, username: str = "alice") -> dict[str, str]:
    client.post("/api/auth/register", json={"username": username, "password": "secret123"})
    token = client.post(
        "/api/auth/login", data={"username": username, "password": "secret123"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def bot_configured(monkeypatch):
    """Pin bot config explicitly: the container may carry a real backend/.env."""
    monkeypatch.setattr(settings, "telegram_bot_token", "test-token")
    monkeypatch.setattr(settings, "telegram_bot_username", "test_bot")


@pytest.fixture()
def bot_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", None)
    monkeypatch.setattr(settings, "telegram_bot_username", None)


def test_settings_defaults(client, bot_unconfigured):
    headers = register_and_login(client)

    body = client.get("/api/account/settings", headers=headers).json()

    assert body["timezone"] == "UTC"
    assert body["reminder_time"] == "09:00:00"
    assert body["notifications_enabled"] is False
    assert body["telegram_linked"] is False
    assert body["bot_configured"] is False


def test_settings_require_auth(client):
    assert client.get("/api/account/settings").status_code == 401


def test_patch_updates_only_supplied_fields(client, bot_unconfigured):
    headers = register_and_login(client)

    body = client.patch(
        "/api/account/settings", json={"timezone": "Asia/Bishkek"}, headers=headers
    ).json()
    assert body["timezone"] == "Asia/Bishkek"
    assert body["reminder_time"] == "09:00:00"

    body = client.patch(
        "/api/account/settings", json={"reminder_time": "07:30:00"}, headers=headers
    ).json()
    assert body["timezone"] == "Asia/Bishkek"
    assert body["reminder_time"] == "07:30:00"


def test_unknown_timezone_is_rejected(client, bot_unconfigured):
    headers = register_and_login(client)

    response = client.patch(
        "/api/account/settings", json={"timezone": "Mars/Olympus"}, headers=headers
    )

    assert response.status_code == 422


def test_link_returns_deep_link(client, bot_configured):
    headers = register_and_login(client)

    body = client.post("/api/account/telegram/link", headers=headers).json()

    assert body["deep_link_url"].startswith("https://t.me/test_bot?start=")
    assert body["expires_at"]


def test_link_unavailable_without_bot_config(client, bot_unconfigured):
    headers = register_and_login(client)

    response = client.post("/api/account/telegram/link", headers=headers)

    assert response.status_code == 503


def test_link_requires_both_token_and_username(client, monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", "test-token")
    monkeypatch.setattr(settings, "telegram_bot_username", None)
    headers = register_and_login(client)

    assert client.post("/api/account/telegram/link", headers=headers).status_code == 503
    assert client.get("/api/account/settings", headers=headers).json()["bot_configured"] is False


def test_unlink_is_idempotent(client, bot_configured):
    headers = register_and_login(client)

    assert client.delete("/api/account/telegram", headers=headers).status_code == 204
    assert client.delete("/api/account/telegram", headers=headers).status_code == 204
    assert client.get("/api/account/settings", headers=headers).json()["telegram_linked"] is False


def test_settings_are_per_user(client, bot_unconfigured):
    alice = register_and_login(client, "alice")
    bob = register_and_login(client, "bob")

    client.patch("/api/account/settings", json={"timezone": "Asia/Bishkek"}, headers=alice)

    assert client.get("/api/account/settings", headers=bob).json()["timezone"] == "UTC"
