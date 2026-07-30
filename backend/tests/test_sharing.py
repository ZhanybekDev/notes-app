from app.schemas import PublicNoteOut


def _auth(client, username="user1", password="pw123456"):
    client.post("/api/auth/register", json={"username": username, "password": password})
    r = client.post("/api/auth/login", data={"username": username, "password": password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _note(client, headers, **fields):
    payload = {"title": "Shared", "content": "# Heading\n\nbody", **fields}
    return client.post("/api/notes", headers=headers, json=payload).json()["id"]


def test_share_returns_a_token_and_the_link_reads_without_a_session(client):
    h = _auth(client)
    nid = _note(client, h, tags=["work"], note_date="2026-08-01")

    r = client.post(f"/api/notes/{nid}/share", headers=h)
    assert r.status_code == 200
    token = r.json()["share_token"]
    assert len(token) >= 40

    # No Authorization header: the whole point of the feature.
    r = client.get(f"/api/public/notes/{token}")
    assert r.status_code == 200
    assert r.json()["title"] == "Shared"
    assert r.json()["content"] == "# Heading\n\nbody"
    assert r.json()["tags"] == ["work"]


def test_the_public_payload_carries_nothing_private():
    # Asserted against the schema rather than one response, so a field added to PublicNoteOut has
    # to be added here too — which is the moment somebody decides whether it may be public.
    assert set(PublicNoteOut.model_fields) == {
        "title",
        "content",
        "tags",
        "note_date",
        "updated_at",
    }


def test_the_owner_sees_the_live_link_on_their_own_note(client):
    h = _auth(client)
    nid = _note(client, h)
    assert client.get(f"/api/notes/{nid}", headers=h).json()["share_token"] is None

    token = client.post(f"/api/notes/{nid}/share", headers=h).json()["share_token"]

    # Without this the editor would keep offering to share a note that already has a link.
    assert client.get(f"/api/notes/{nid}", headers=h).json()["share_token"] == token


def test_sharing_twice_keeps_the_link_already_handed_out(client):
    h = _auth(client)
    nid = _note(client, h)

    first = client.post(f"/api/notes/{nid}/share", headers=h).json()
    second = client.post(f"/api/notes/{nid}/share", headers=h).json()

    # A second token would silently break a link somebody had already sent.
    assert first["share_token"] == second["share_token"]
    assert first["shared_at"] == second["shared_at"]


def test_revoking_kills_the_link_and_a_new_share_is_a_new_token(client):
    h = _auth(client)
    nid = _note(client, h)
    token = client.post(f"/api/notes/{nid}/share", headers=h).json()["share_token"]

    assert client.delete(f"/api/notes/{nid}/share", headers=h).status_code == 204
    assert client.get(f"/api/public/notes/{token}").status_code == 404

    fresh = client.post(f"/api/notes/{nid}/share", headers=h).json()["share_token"]
    assert fresh != token
    assert client.get(f"/api/public/notes/{fresh}").status_code == 200


def test_every_rejection_looks_the_same(client):
    h = _auth(client)
    nid = _note(client, h)
    token = client.post(f"/api/notes/{nid}/share", headers=h).json()["share_token"]
    client.delete(f"/api/notes/{nid}/share", headers=h)

    revoked = client.get(f"/api/public/notes/{token}")
    never_existed = client.get("/api/public/notes/" + "x" * 43)

    # A different status or body for "revoked" would answer a question the reader may not ask.
    assert revoked.status_code == never_existed.status_code == 404
    assert revoked.json() == never_existed.json()


def test_archiving_takes_the_note_off_the_link(client):
    h = _auth(client)
    nid = _note(client, h)
    token = client.post(f"/api/notes/{nid}/share", headers=h).json()["share_token"]

    client.post(f"/api/notes/{nid}/archive", headers=h)
    assert client.get(f"/api/public/notes/{token}").status_code == 404

    # And comes back with it: archiving is "put away", not "revoke".
    client.post(f"/api/notes/{nid}/unarchive", headers=h)
    assert client.get(f"/api/public/notes/{token}").status_code == 200


def test_deleting_the_note_kills_the_link(client):
    h = _auth(client)
    nid = _note(client, h)
    token = client.post(f"/api/notes/{nid}/share", headers=h).json()["share_token"]

    client.delete(f"/api/notes/{nid}", headers=h)
    assert client.get(f"/api/public/notes/{token}").status_code == 404


def test_only_the_owner_can_share_or_revoke(client):
    owner = _auth(client, "alice", "pw123456")
    stranger = _auth(client, "eve", "pw123456")
    nid = _note(client, owner)

    assert client.post(f"/api/notes/{nid}/share", headers=stranger).status_code == 404
    token = client.post(f"/api/notes/{nid}/share", headers=owner).json()["share_token"]
    assert client.delete(f"/api/notes/{nid}/share", headers=stranger).status_code == 404
    # The stranger's failed revoke did not touch the link.
    assert client.get(f"/api/public/notes/{token}").status_code == 200


def test_the_shared_page_asks_not_to_be_indexed_or_cached(client):
    h = _auth(client)
    nid = _note(client, h)
    token = client.post(f"/api/notes/{nid}/share", headers=h).json()["share_token"]

    r = client.get(f"/api/public/notes/{token}")

    # Links get pasted in public places; a note shared with one person is not a search result.
    assert "noindex" in r.headers["x-robots-tag"]
    assert r.headers["cache-control"] == "no-store"


def test_an_unshared_note_has_no_link_at_all(client):
    h = _auth(client)
    _note(client, h)

    # Nothing to guess at: a note nobody shared resolves through no token.
    assert client.get("/api/public/notes/" + "y" * 43).status_code == 404


def test_public_reads_are_throttled_per_client(client):
    h = _auth(client)
    nid = _note(client, h)
    token = client.post(f"/api/notes/{nid}/share", headers=h).json()["share_token"]

    codes = {client.get(f"/api/public/notes/{token}").status_code for _ in range(61)}

    # Enumeration is what this bounds; a person reading their link never reaches 60 in a minute.
    assert 429 in codes


def test_the_public_limiter_forgets_addresses_that_went_quiet():
    from app.rate_limit import _PUBLIC_WINDOW_SECONDS, _public_hits, check_public_rate_limit

    class _Request:
        def __init__(self, host):
            self.client = type("C", (), {"host": host})()

    check_public_rate_limit(_Request("10.0.0.1"))
    assert "10.0.0.1" in _public_hits

    # Age the entry out by hand rather than sleeping a minute.
    _public_hits["10.0.0.1"][0] -= _PUBLIC_WINDOW_SECONDS + 1
    check_public_rate_limit(_Request("10.0.0.2"))
    check_public_rate_limit(_Request("10.0.0.1"))

    # Two live addresses, not a growing list of every address that ever called.
    assert set(_public_hits) == {"10.0.0.1", "10.0.0.2"}
    assert len(_public_hits["10.0.0.1"]) == 1
