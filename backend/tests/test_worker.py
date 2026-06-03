import os

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test-secret-with-at-least-32-characters")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import scripts.worker as worker
from app.db import Base
from app.models import User
from app.reminders import issue_link_code


@pytest.fixture()
def Session(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'w.db'}",
        connect_args={"check_same_thread": False},
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    factory = sessionmaker(bind=engine, future=True)
    # handle_update opens its own session via the module-level SessionLocal.
    monkeypatch.setattr(worker, "SessionLocal", factory)
    return factory


class FakeClient:
    def __init__(self):
        self.sent = []

    def send_message(self, chat_id, text):
        self.sent.append((chat_id, text))


def _user_with_code(Session) -> str:
    db = Session()
    user = User(username="u", password_hash="x")
    db.add(user)
    db.commit()
    code = issue_link_code(db, user)
    db.close()
    return code


def test_handle_update_links_chat_on_start(Session):
    code = _user_with_code(Session)
    client = FakeClient()
    update = {"update_id": 1, "message": {"text": f"/start {code}", "chat": {"id": 999}}}

    worker.handle_update(update, client)

    db = Session()
    user = db.query(User).first()
    assert user.telegram_chat_id == "999"
    assert user.telegram_enabled is True
    db.close()
    assert client.sent and "Linked" in client.sent[0][1]


def test_handle_update_invalid_code_replies(Session):
    client = FakeClient()
    update = {"update_id": 2, "message": {"text": "/start nope", "chat": {"id": 5}}}

    worker.handle_update(update, client)

    assert client.sent and "invalid or expired" in client.sent[0][1]


def test_handle_update_ignores_non_start(Session):
    client = FakeClient()
    worker.handle_update({"update_id": 3, "message": {"text": "hi", "chat": {"id": 5}}}, client)
    assert client.sent == []


def test_handle_update_never_raises_on_bad_update(Session):
    # A malformed update must be swallowed so the poll loop can advance the offset.
    worker.handle_update({"update_id": 4}, FakeClient())
