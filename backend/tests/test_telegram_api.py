import os

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test-secret-with-at-least-32-characters")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import deps
from app.config import settings
from app.db import Base
from app.main import app
from app.models import User
from app.rate_limit import reset_auth_rate_limits


@pytest.fixture()
def api(tmp_path):
    reset_auth_rate_limits()
    engine = create_engine(
        f"sqlite:///{tmp_path / 'api.db'}",
        connect_args={"check_same_thread": False},
        future=True,
    )
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[deps.get_db] = override_get_db
    with TestClient(app) as c:
        yield c, TestingSession
    app.dependency_overrides.clear()
    reset_auth_rate_limits()
    Base.metadata.drop_all(bind=engine)


def _auth(client, username="user1", password="pw123456"):
    client.post("/api/auth/register", json={"username": username, "password": password})
    r = client.post("/api/auth/login", data={"username": username, "password": password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture()
def telegram_enabled(monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", "test-token", raising=False)
    monkeypatch.setattr(settings, "telegram_bot_username", "notes_demo_bot", raising=False)


def test_status_defaults(api):
    client, _ = api
    h = _auth(client)
    r = client.get("/api/account/telegram", headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body == {
        "linked": False,
        "enabled": False,
        "timezone": "UTC",
        "bot_configured": False,
        "link_url": None,
    }


def test_link_requires_configured_bot(api):
    client, _ = api
    h = _auth(client)
    r = client.post("/api/account/telegram/link", headers=h)
    assert r.status_code == 503


def test_link_returns_deep_link(api, telegram_enabled):
    client, Session = api
    h = _auth(client)
    r = client.post("/api/account/telegram/link", headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["bot_configured"] is True
    assert body["link_url"].startswith("https://t.me/notes_demo_bot?start=")

    # A link code was persisted for the worker to resolve.
    with Session() as s:
        user = s.query(User).filter(User.username == "user1").one()
        assert user.telegram_link_code is not None


def test_set_timezone_valid_and_invalid(api):
    client, _ = api
    h = _auth(client)
    r = client.put("/api/account/telegram/timezone", headers=h, json={"timezone": "Europe/London"})
    assert r.status_code == 200
    assert r.json()["timezone"] == "Europe/London"

    r = client.put("/api/account/telegram/timezone", headers=h, json={"timezone": "Mars/Olympus"})
    assert r.status_code == 422


def test_enable_reminders_requires_link(api):
    client, _ = api
    h = _auth(client)
    r = client.put("/api/account/telegram/reminders", headers=h, json={"enabled": True})
    assert r.status_code == 409


def test_toggle_reminders_and_unlink(api):
    client, Session = api
    h = _auth(client)
    # Simulate a completed link (worker would do this).
    with Session() as s:
        user = s.query(User).filter(User.username == "user1").one()
        user.telegram_chat_id = "999"
        s.commit()

    r = client.put("/api/account/telegram/reminders", headers=h, json={"enabled": True})
    assert r.status_code == 200
    assert r.json() == {
        "linked": True,
        "enabled": True,
        "timezone": "UTC",
        "bot_configured": False,
        "link_url": None,
    }

    r = client.put("/api/account/telegram/reminders", headers=h, json={"enabled": False})
    assert r.json()["enabled"] is False

    r = client.request("DELETE", "/api/account/telegram", headers=h)
    assert r.status_code == 200
    r = client.get("/api/account/telegram", headers=h)
    assert r.json()["linked"] is False


def test_endpoints_require_auth(api):
    client, _ = api
    assert client.get("/api/account/telegram").status_code == 401
