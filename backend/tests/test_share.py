import os

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test-secret-with-at-least-32-characters")


def _auth(client, username="user1", password="pw123456"):
    client.post("/api/auth/register", json={"username": username, "password": password})
    r = client.post("/api/auth/login", data={"username": username, "password": password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _note(client, h, title="Public note", content="hello **world**"):
    return client.post("/api/notes", headers=h, json={"title": title, "content": content}).json()


def test_share_then_read_public(client):
    h = _auth(client)
    note = _note(client, h)
    assert note["public_token"] is None

    r = client.post(f"/api/notes/{note['id']}/share", headers=h)
    assert r.status_code == 200
    token = r.json()["token"]
    assert token

    # Public read - no auth header at all.
    r = client.get(f"/api/share/{token}")
    assert r.status_code == 200
    body = r.json()
    assert body["title"] == "Public note"
    assert body["content"] == "hello **world**"
    # Must not leak owner / internal ids.
    assert "user_id" not in body
    assert "id" not in body


def test_share_is_idempotent(client):
    h = _auth(client)
    note = _note(client, h)
    t1 = client.post(f"/api/notes/{note['id']}/share", headers=h).json()["token"]
    t2 = client.post(f"/api/notes/{note['id']}/share", headers=h).json()["token"]
    assert t1 == t2


def test_unshare_revokes(client):
    h = _auth(client)
    note = _note(client, h)
    token = client.post(f"/api/notes/{note['id']}/share", headers=h).json()["token"]

    r = client.request("DELETE", f"/api/notes/{note['id']}/share", headers=h)
    assert r.status_code == 200
    assert client.get(f"/api/share/{token}").status_code == 404


def test_invalid_token_404(client):
    assert client.get("/api/share/nope").status_code == 404


def test_cannot_share_others_note(client):
    h1 = _auth(client, "alice", "pw123456")
    note = _note(client, h1)
    h2 = _auth(client, "bob", "pw123456")
    assert client.post(f"/api/notes/{note['id']}/share", headers=h2).status_code == 404


def test_share_requires_auth(client):
    assert client.post("/api/notes/1/share").status_code == 401
