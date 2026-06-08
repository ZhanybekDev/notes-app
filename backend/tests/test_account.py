from datetime import UTC, datetime, timedelta

from app.bot_worker import process_update
from app.models import User


def _register_login(client, username="user1", password="pw123456"):
    client.post("/api/auth/register", json={"username": username, "password": password})
    r = client.post(
        "/api/auth/login",
        data={"username": username, "password": password},
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


class _SilentBot:
    def send_message(self, _chat_id, _text):
        return None


def test_change_password(client):
    h = _register_login(client)

    # Wrong old password.
    r = client.post(
        "/api/account/change-password",
        headers=h,
        json={"current_password": "wrong", "new_password": "newpass123"},
    )
    assert r.status_code == 401

    # Correct old password.
    r = client.post(
        "/api/account/change-password",
        headers=h,
        json={"current_password": "pw123456", "new_password": "newpass123"},
    )
    assert r.status_code == 200

    # Old password no longer works.
    r = client.post("/api/auth/login", data={"username": "user1", "password": "pw123456"})
    assert r.status_code == 401

    # New password works.
    r = client.post("/api/auth/login", data={"username": "user1", "password": "newpass123"})
    assert r.status_code == 200


def test_change_password_wrong_current_password_is_rate_limited(client):
    h = _register_login(client)

    for _ in range(5):
        r = client.post(
            "/api/account/change-password",
            headers=h,
            json={"current_password": "wrong", "new_password": "newpass123"},
        )
        assert r.status_code == 401

    r = client.post(
        "/api/account/change-password",
        headers=h,
        json={"current_password": "wrong", "new_password": "newpass123"},
    )
    assert r.status_code == 429


def test_get_telegram_settings_initial_state(client):
    h = _register_login(client)

    r = client.get("/api/account/telegram", headers=h)

    assert r.status_code == 200
    assert r.json() == {
        "available": False,
        "connected": False,
        "telegram_username": None,
        "notifications_enabled": False,
        "link_code": None,
        "link_code_expires_at": None,
    }


def test_generate_telegram_link_replaces_old_code(client, monkeypatch):
    from app.routers import account as account_router

    monkeypatch.setattr(account_router.settings, "telegram_bot_token", "test-token")
    h = _register_login(client)

    first = client.post("/api/account/telegram/link", headers=h)
    second = client.post("/api/account/telegram/link", headers=h)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["link_code"]
    assert second.json()["link_code"]
    assert first.json()["link_code"] != second.json()["link_code"]
    assert first.json()["link_code_expires_at"] is not None
    assert second.json()["link_code_expires_at"] is not None


def test_update_telegram_settings_requires_connected_account(client):
    h = _register_login(client)

    r = client.put(
        "/api/account/telegram",
        headers=h,
        json={"notifications_enabled": True},
    )

    assert r.status_code == 409
    assert r.json()["detail"] == "Connect Telegram before enabling reminders"


def test_unlink_telegram_clears_connection(client, monkeypatch):
    from app.routers import account as account_router

    monkeypatch.setattr(account_router.settings, "telegram_bot_token", "test-token")
    h = _register_login(client, username="linked-user")
    link = client.post("/api/account/telegram/link", headers=h)
    assert link.status_code == 200

    with client.session_factory() as db:
        user = db.query(User).filter(User.username == "linked-user").one()
        process_update(
            db,
            _SilentBot(),
            {
                "message": {
                    "text": f"/start {user.telegram_link_code}",
                    "chat": {"id": 123456},
                    "from": {"username": "linked_demo"},
                }
            },
            now=datetime.now(UTC) + timedelta(minutes=1),
        )

    r = client.post("/api/account/telegram/unlink", headers=h)

    assert r.status_code == 200
    assert r.json()["connected"] is False
    assert r.json()["telegram_username"] is None
    assert r.json()["notifications_enabled"] is False
    assert r.json()["link_code"] is None


def test_delete_account(client):
    h = _register_login(client, "alice", "pw123456")
    client.post("/api/notes", headers=h, json={"title": "mine", "content": ""})

    # Wrong password.
    r = client.request(
        "DELETE",
        "/api/account",
        headers=h,
        json={"password": "wrong"},
    )
    assert r.status_code == 401

    # Correct password.
    r = client.request(
        "DELETE",
        "/api/account",
        headers=h,
        json={"password": "pw123456"},
    )
    assert r.status_code == 204

    # Subsequent requests with the old token should fail (user gone).
    r = client.get("/api/notes", headers=h)
    assert r.status_code == 401

    # Username can now be taken by a new registration.
    r = client.post("/api/auth/register", json={"username": "alice", "password": "newpass123"})
    assert r.status_code == 201
