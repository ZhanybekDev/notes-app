import io
import os
import re
import zipfile

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test-secret-with-at-least-32-characters")


def _auth(client, username="user1", password="pw123456"):
    client.post("/api/auth/register", json={"username": username, "password": password})
    r = client.post("/api/auth/login", data={"username": username, "password": password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _make_note(client, h, title="My note", content="# Hello\n\nbody", tags=None, note_date=None):
    payload = {"title": title, "content": content, "tags": tags or [], "note_date": note_date}
    return client.post("/api/notes", headers=h, json=payload).json()


def test_export_note_markdown(client):
    h = _auth(client)
    note = _make_note(client, h, title="Trip plan", content="pack bags", note_date="2026-06-03")
    r = client.get(f"/api/export/note/{note['id']}", headers=h)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/markdown")
    assert re.search(r'filename="trip-plan-\d{8}-\d{6}\.md"', r.headers["content-disposition"])
    text = r.text
    assert "# Trip plan" in text
    assert "Date: 2026-06-03" in text
    assert "pack bags" in text


def test_export_note_not_found_for_other_user(client):
    h1 = _auth(client, "alice", "pw123456")
    note = _make_note(client, h1)
    h2 = _auth(client, "bob", "pw123456")
    r = client.get(f"/api/export/note/{note['id']}", headers=h2)
    assert r.status_code == 404


def test_export_note_requires_auth(client):
    assert client.get("/api/export/note/1").status_code == 401


def test_export_all_zip(client):
    h = _auth(client)
    _make_note(client, h, title="One")
    _make_note(client, h, title="Two")
    r = client.get("/api/export/notes", headers=h)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    assert re.search(r'filename="notes-\d{8}-\d{6}\.zip"', r.headers["content-disposition"])

    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        names = zf.namelist()
        assert len(names) == 2
        assert all(n.endswith(".md") for n in names)
        first = zf.read(names[0]).decode()
        assert first.startswith("# ")


def test_export_all_zip_only_own_notes(client):
    h1 = _auth(client, "alice", "pw123456")
    _make_note(client, h1, title="Alice note")
    h2 = _auth(client, "bob", "pw123456")
    _make_note(client, h2, title="Bob note")

    r = client.get("/api/export/notes", headers=h1)
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        assert len(zf.namelist()) == 1
