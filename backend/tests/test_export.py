import io
import zipfile

from app.export import filenames_for, slugify, to_markdown


class _FakeNote:
    def __init__(self, id, title, content="", tags=None, note_date=None, updated_at=None):
        self.id = id
        self.title = title
        self.content = content
        self.tags = tags or []
        self.note_date = note_date
        self.updated_at = updated_at


def _auth(client, username="user1", password="pw123456"):
    client.post("/api/auth/register", json={"username": username, "password": password})
    r = client.post("/api/auth/login", data={"username": username, "password": password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _note(client, headers, **fields):
    payload = {"title": "Note", "content": "body", **fields}
    return client.post("/api/notes", headers=headers, json=payload).json()["id"]


def test_a_title_cannot_become_a_path():
    # The only safe way to treat a title as a path component is to make it incapable of being
    # anything else — escaping invites the next reader to unescape.
    assert "/" not in slugify("../../etc/passwd")
    assert ".." not in slugify("..")
    assert slugify("../../etc/passwd") == "etcpasswd"
    assert slugify("/") == "note"
    assert slugify("") == "note"
    assert slugify("   ") == "note"
    assert slugify("...") == "note"


def test_a_title_keeps_its_own_alphabet():
    assert slugify("Планы на квартал") == "Планы на квартал"
    assert slugify("Q3: ship it!") == "Q3 ship it"


def test_a_long_title_is_truncated_to_a_usable_name():
    name = slugify("x" * 300)
    assert len(name) == 80


def test_two_notes_with_one_title_both_carry_their_id():
    names = filenames_for([_FakeNote(1, "Meeting"), _FakeNote(2, "Meeting"), _FakeNote(3, "Other")])

    # Neither of the two looks arbitrarily privileged, and a name stays with its note across
    # exports — a counter would rename files whenever an unrelated note appears.
    assert names[1] == "Meeting-1.md"
    assert names[2] == "Meeting-2.md"
    assert names[3] == "Other.md"


def test_a_title_cannot_steal_another_notes_disambiguated_name():
    # "Meeting-1" is exactly what two notes called "Meeting" turn the first one into. Two entries
    # under one name is not an error anywhere: zipfile writes both, extraction keeps the last, and
    # the export quietly loses a note.
    names = filenames_for(
        [_FakeNote(1, "Meeting"), _FakeNote(2, "Meeting-1"), _FakeNote(3, "Meeting")]
    )

    assert len(set(names.values())) == 3
    assert names[1] == "Meeting-1.md"
    assert names[2] == "Meeting-1-2.md"
    assert names[3] == "Meeting-3.md"


def test_untitled_notes_do_not_collide():
    names = filenames_for([_FakeNote(1, ""), _FakeNote(2, "   ")])
    assert names[1] != names[2]


def test_front_matter_survives_punctuation_in_a_title():
    import datetime as dt

    note = _FakeNote(
        1,
        'He said: "no"\\backslash',
        content="body",
        tags=["work"],
        updated_at=dt.datetime(2026, 7, 30, 10, 0, 0),
    )
    md = to_markdown(note)

    # A colon and a quote in a title are ordinary; pasting them between quotes would produce
    # something no YAML reader accepts.
    assert '"He said: \\"no\\"\\\\backslash"' in md
    assert 'tags: ["work"]' in md
    assert md.endswith("body")


def test_export_one_note_as_markdown(client):
    h = _auth(client)
    nid = _note(client, h, title="Планы", content="# Q3", tags=["work"], note_date="2026-08-01")

    r = client.get(f"/api/notes/{nid}/export", headers=h)

    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/markdown")
    body = r.text
    assert 'title: "Планы"' in body
    assert "date: 2026-08-01" in body
    assert body.endswith("# Q3")


def test_a_cyrillic_filename_is_offered_in_both_forms(client):
    h = _auth(client)
    nid = _note(client, h, title="Планы")

    disposition = client.get(f"/api/notes/{nid}/export", headers=h).headers["content-disposition"]

    # Old clients read `filename`, modern ones prefer `filename*`; without the second a Cyrillic
    # title arrives as mojibake.
    assert "filename*=UTF-8''" in disposition
    assert "%D0%9F" in disposition


def test_export_all_notes_as_a_zip(client):
    h = _auth(client)
    _note(client, h, title="First", content="one")
    _note(client, h, title="Second", content="two")

    r = client.get("/api/notes/export", headers=h)

    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    archive = zipfile.ZipFile(io.BytesIO(r.content))
    assert sorted(archive.namelist()) == ["First.md", "Second.md"]
    assert archive.read("First.md").decode().endswith("one")


def test_the_collection_path_is_not_read_as_a_note_id(client):
    h = _auth(client)
    _note(client, h)

    # FastAPI matches routes in declaration order: with `/{note_id}` first, this request would be
    # a lookup of a note called "export" and answer 422.
    assert client.get("/api/notes/export", headers=h).status_code == 200


def test_export_takes_the_same_filters_as_the_listing(client):
    h = _auth(client)
    _note(client, h, title="Work", tags=["work"])
    _note(client, h, title="Home", tags=["home"])
    archived_id = _note(client, h, title="Old")
    client.post(f"/api/notes/{archived_id}/archive", headers=h)

    by_tag = zipfile.ZipFile(
        io.BytesIO(client.get("/api/notes/export?tag=work", headers=h).content)
    )
    assert by_tag.namelist() == ["Work.md"]

    by_query = zipfile.ZipFile(
        io.BytesIO(client.get("/api/notes/export?q=Home", headers=h).content)
    )
    assert by_query.namelist() == ["Home.md"]

    # Archived notes are excluded by default, exactly as they are from the list.
    default = zipfile.ZipFile(io.BytesIO(client.get("/api/notes/export", headers=h).content))
    assert "Old.md" not in default.namelist()
    archived = zipfile.ZipFile(
        io.BytesIO(client.get("/api/notes/export?archived=true", headers=h).content)
    )
    assert archived.namelist() == ["Old.md"]


def test_an_export_of_nothing_is_an_empty_zip_rather_than_an_error(client):
    h = _auth(client)

    r = client.get("/api/notes/export", headers=h)

    assert r.status_code == 200
    assert zipfile.ZipFile(io.BytesIO(r.content)).namelist() == []


def test_export_never_reaches_another_account(client):
    owner = _auth(client, "alice", "pw123456")
    stranger = _auth(client, "eve", "pw123456")
    nid = _note(client, owner, title="Private")

    assert client.get(f"/api/notes/{nid}/export", headers=stranger).status_code == 404
    theirs = zipfile.ZipFile(io.BytesIO(client.get("/api/notes/export", headers=stranger).content))
    assert theirs.namelist() == []


def test_export_needs_a_session(client):
    assert client.get("/api/notes/export").status_code == 401
