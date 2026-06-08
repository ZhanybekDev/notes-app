from datetime import date, datetime

from app.models import Note


def _auth(client, username="user1", password="pw123456"):
    client.post("/api/auth/register", json={"username": username, "password": password})
    r = client.post(
        "/api/auth/login",
        data={"username": username, "password": password},
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_create_and_list_note(client):
    h = _auth(client)
    r = client.post(
        "/api/notes",
        headers=h,
        json={"title": "T1", "content": "hello", "tags": ["Work", "work", " "]},
    )
    assert r.status_code == 201
    note = r.json()
    assert note["title"] == "T1"
    assert note["tags"] == ["work"]

    r = client.get("/api/notes", headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert len(body["items"]) == 1


def test_note_isolation_between_users(client):
    h1 = _auth(client, "alice", "pw123456")
    h2 = _auth(client, "eve", "pw123456")
    r = client.post("/api/notes", headers=h1, json={"title": "alice-note", "content": ""})
    nid = r.json()["id"]

    assert client.get(f"/api/notes/{nid}", headers=h2).status_code == 404
    assert client.get("/api/notes", headers=h2).json()["items"] == []


def test_search_notes(client):
    h = _auth(client)
    client.post("/api/notes", headers=h, json={"title": "Go shopping", "content": ""})
    client.post("/api/notes", headers=h, json={"title": "Read book", "content": "about Go"})
    r = client.get("/api/notes", headers=h, params={"q": "go"})
    assert r.status_code == 200
    assert r.json()["total"] == 2


def test_calendar_excludes_archived(client):
    h = _auth(client)
    r1 = client.post(
        "/api/notes",
        headers=h,
        json={"title": "dated", "content": "", "note_date": "2026-04-10"},
    )
    client.post("/api/notes", headers=h, json={"title": "undated", "content": ""})
    # Archive the dated one — calendar should then be empty for the month.
    nid = r1.json()["id"]
    assert client.post(f"/api/notes/{nid}/archive", headers=h).status_code == 200

    r = client.get("/api/notes/calendar", headers=h, params={"year": 2026, "month": 4})
    assert r.status_code == 200
    assert r.json() == []


def test_calendar(client):
    h = _auth(client)
    client.post(
        "/api/notes",
        headers=h,
        json={"title": "dated", "content": "", "note_date": "2026-04-10"},
    )
    r = client.get("/api/notes/calendar", headers=h, params={"year": 2026, "month": 4})
    days = r.json()
    assert len(days) == 1
    assert days[0]["date"] == "2026-04-10"


def test_tags_endpoint(client):
    h = _auth(client)
    client.post(
        "/api/notes", headers=h, json={"title": "n1", "content": "", "tags": ["work", "urgent"]}
    )
    client.post("/api/notes", headers=h, json={"title": "n2", "content": "", "tags": ["personal"]})
    r = client.get("/api/tags", headers=h)
    assert sorted(r.json()) == ["personal", "urgent", "work"]


def test_filter_by_tag(client):
    h = _auth(client)
    client.post("/api/notes", headers=h, json={"title": "n1", "content": "", "tags": ["work"]})
    client.post("/api/notes", headers=h, json={"title": "n2", "content": "", "tags": ["home"]})
    r = client.get("/api/notes", headers=h, params={"tag": "work"})
    items = r.json()["items"]
    assert [n["title"] for n in items] == ["n1"]


def test_updating_note_date_resets_reminder_state(client):
    h = _auth(client, "dated-user", "pw123456")
    create = client.post(
        "/api/notes",
        headers=h,
        json={"title": "dated", "content": "", "note_date": "2026-04-10"},
    )
    note_id = create.json()["id"]

    with client.session_factory() as db:
        note = db.get(Note, note_id)
        note.reminder_sent_at = datetime(2026, 4, 10, 9, 0, 0)
        note.reminder_sent_for_date = date(2026, 4, 10)
        db.commit()

    update = client.put(
        f"/api/notes/{note_id}",
        headers=h,
        json={"title": "dated", "content": "", "tags": [], "note_date": "2026-04-11"},
    )

    assert update.status_code == 200
    with client.session_factory() as db:
        note = db.get(Note, note_id)
        assert note.reminder_sent_at is None
        assert note.reminder_sent_for_date is None
