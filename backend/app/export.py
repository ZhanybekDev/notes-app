"""Turning notes into files.

Kept out of the router because none of it is about HTTP: a note becomes markdown, a title becomes a
filename, a list becomes a zip. All three have edge cases worth testing without a client.
"""

from __future__ import annotations

import json
import re
import zipfile
from collections.abc import Iterable
from tempfile import SpooledTemporaryFile
from typing import IO

from .models import Note

# Long enough to stay recognisable, short enough that the slug plus a suffix and the extension stay
# under the 255-byte limit every common filesystem shares.
MAX_SLUG_LENGTH = 80
# Below this the zip lives in memory; above it, the same object spills to disk on its own. An
# account with thousands of notes must not decide how much memory the process uses.
SPOOL_THRESHOLD_BYTES = 8 * 1024 * 1024

# Anything that is not a letter, digit, space, dash or underscore. Unicode-aware, so Русский
# заголовок keeps its own alphabet instead of becoming a row of underscores.
_UNSAFE = re.compile(r"[^\w \-]", re.UNICODE)
_SPACES = re.compile(r"\s+")


def slugify(title: str) -> str:
    """A filename that means something, and cannot mean somewhere else.

    Path separators, `..` and control characters are removed rather than escaped: a title is not a
    path, and the only safe way to treat one as a path component is to make it incapable of being
    anything else. A title that leaves nothing behind — punctuation only, or empty — falls back to a
    fixed word, and the caller adds the id that makes it unique.
    """
    cleaned = _UNSAFE.sub("", title or "").strip(" .")
    cleaned = _SPACES.sub(" ", cleaned).strip()
    if not cleaned:
        return "note"
    return cleaned[:MAX_SLUG_LENGTH].strip()


def to_markdown(note: Note) -> str:
    """One note as a file, with its metadata in front matter so it can come back.

    Values go through `json.dumps` rather than being pasted between quotes: a title containing a
    colon, a quote or a backslash is ordinary, and JSON happens to be valid YAML, so this is both
    correct and boring.
    """
    front = [
        "---",
        f"title: {json.dumps(note.title, ensure_ascii=False)}",
        f"date: {note.note_date.isoformat() if note.note_date else 'null'}",
        f"tags: {json.dumps(note.tags or [], ensure_ascii=False)}",
        f"updated: {note.updated_at.isoformat()}" if note.updated_at else "updated: null",
        "---",
        "",
    ]
    return "\n".join(front) + (note.content or "")


def filenames_for(notes: Iterable[Note]) -> dict[int, str]:
    """Assign each note a name, and settle collisions by identity rather than by counter.

    Two notes called "Meeting" are common, an empty title is common, and a counter would rename a
    file every time an unrelated note is added or removed. Appending the note's id keeps a given
    note's filename stable across exports, which is what matters if someone exports into the same
    folder twice.
    """
    seen: dict[str, int] = {}
    names: dict[int, str] = {}
    for note in notes:
        slug = slugify(note.title)
        if slug in seen:
            names[note.id] = f"{slug}-{note.id}.md"
            # The first note keeps its bare name only until a second one claims the slug; from then
            # on both carry an id, so neither looks arbitrarily privileged.
            first = seen[slug]
            if first is not None:
                names[first] = f"{slug}-{first}.md"
                seen[slug] = None
        else:
            seen[slug] = note.id
            names[note.id] = f"{slug}.md"
    return names


def write_zip(notes: list[Note]) -> IO[bytes]:
    """Build the archive into a spooled file and hand it back positioned at the start.

    `ZIP_DEFLATED` because notes are text and compress to a fraction; the caller streams the result
    rather than holding the bytes.
    """
    names = filenames_for(notes)
    # Not a context manager on purpose: the caller streams from this handle after the function
    # returns and closes it when the response is done. Closing it here would hand back a dead file.
    buffer = SpooledTemporaryFile(max_size=SPOOL_THRESHOLD_BYTES)  # noqa: SIM115
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for note in notes:
            info = zipfile.ZipInfo(names[note.id], date_time=note.updated_at.timetuple()[:6])
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, to_markdown(note))
    buffer.seek(0)
    return buffer
