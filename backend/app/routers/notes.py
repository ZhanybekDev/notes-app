import secrets
from calendar import monthrange
from datetime import UTC, date, datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import case, or_
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db
from ..export import filenames_for, to_markdown, write_zip
from ..models import Note, User
from ..schemas import (
    BulkDeleteIn,
    CalendarDay,
    NoteIn,
    NoteOut,
    NotesPage,
    ShareOut,
)

# 32 bytes of urlsafe randomness, 43 characters. Long enough that guessing one is not a strategy,
# which is what lets the public read be a plain GET with no other secret in it.
SHARE_TOKEN_BYTES = 32
# Read back in chunks rather than in one slice: the archive may have spilled to disk, and the point
# of spooling it was not to hold the whole thing in memory afterwards.
ZIP_CHUNK_BYTES = 64 * 1024


def _attachment(filename: str) -> str:
    """A Content-Disposition both a modern browser and an old one can read.

    The plain `filename` is stripped to ASCII as a fallback; `filename*` carries the real one,
    percent-encoded per RFC 5987. Without the second, a Russian title arrives as mojibake or as the
    literal URL of the endpoint.
    """
    ascii_fallback = filename.encode("ascii", "ignore").decode("ascii") or "notes.md"
    return f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quote(filename)}"


router = APIRouter(prefix="/notes", tags=["notes"])


def _normalize_tags(tags: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in tags:
        t = raw.strip().lower()
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    return out


def _own_note_or_404(note_id: int, user: User, db: Session) -> Note:
    note = db.get(Note, note_id)
    if note is None or note.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")
    return note


def _now() -> datetime:
    return datetime.now(UTC)


def _visible_notes(
    db: Session,
    user: User,
    *,
    q: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    archived: bool = False,
):
    """The where-clauses shared by listing and exporting, so "export what you are looking at" is
    true by construction rather than by two copies of the same conditions drifting apart.

    Tag filtering stays with each caller: it runs in Python to remain dialect-agnostic, and in the
    listing it is entangled with paging.
    """
    query = db.query(Note).filter(Note.user_id == user.id)
    query = query.filter(Note.archived_at.is_not(None) if archived else Note.archived_at.is_(None))
    if q:
        pattern = f"%{q}%"
        query = query.filter(or_(Note.title.ilike(pattern), Note.content.ilike(pattern)))
    if date_from:
        query = query.filter(Note.note_date >= date_from)
    if date_to:
        query = query.filter(Note.note_date <= date_to)
    return query


@router.get("", response_model=NotesPage)
def list_notes(
    q: str | None = None,
    tag: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    archived: bool = False,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotesPage:
    query = _visible_notes(db, user, q=q, date_from=date_from, date_to=date_to, archived=archived)

    # Tag filter requires JSON-aware logic; apply in Python to stay dialect-agnostic.
    if tag:
        needle = tag.strip().lower()
        candidates = [n for n in query.all() if needle in (n.tags or [])]
        total = len(candidates)
        candidates.sort(
            key=lambda n: (
                0 if n.pinned_at else 1,
                -(n.pinned_at.timestamp() if n.pinned_at else 0.0),
                -n.updated_at.timestamp(),
                -n.id,
            )
        )
        items = candidates[offset : offset + limit]
        return NotesPage(items=items, total=total, limit=limit, offset=offset)

    total = query.count()
    pin_order = case((Note.pinned_at.is_not(None), 0), else_=1)
    items = (
        query.order_by(
            pin_order,
            Note.pinned_at.desc(),
            Note.updated_at.desc(),
            Note.id.desc(),
        )
        .offset(offset)
        .limit(limit)
        .all()
    )
    return NotesPage(items=items, total=total, limit=limit, offset=offset)


@router.post("", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
def create_note(
    payload: NoteIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Note:
    note = Note(
        user_id=user.id,
        title=payload.title,
        content=payload.content,
        tags=_normalize_tags(payload.tags),
        note_date=payload.note_date,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


@router.get("/calendar", response_model=list[CalendarDay])
def calendar(
    year: int = Query(..., ge=1970, le=3000),
    month: int = Query(..., ge=1, le=12),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CalendarDay]:
    start = date(year, month, 1)
    end = date(year, month, monthrange(year, month)[1])
    notes = (
        db.query(Note)
        .filter(
            Note.user_id == user.id,
            Note.archived_at.is_(None),
            Note.note_date >= start,
            Note.note_date <= end,
        )
        .order_by(Note.note_date.asc(), Note.id.asc())
        .all()
    )
    buckets: dict[date, list[int]] = {}
    for n in notes:
        if n.note_date is not None:
            buckets.setdefault(n.note_date, []).append(n.id)
    return [CalendarDay(date=d, note_ids=ids) for d, ids in sorted(buckets.items())]


@router.post("/bulk-delete", status_code=status.HTTP_204_NO_CONTENT)
def bulk_delete(
    payload: BulkDeleteIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    notes = db.query(Note).filter(Note.user_id == user.id, Note.id.in_(payload.ids)).all()
    for n in notes:
        db.delete(n)
    db.commit()


# Declared before `/{note_id}`: FastAPI matches in declaration order, so the other way round
# this path would be read as a note whose id is the word "export".
@router.get("/export")
def export_notes(
    q: str | None = None,
    tag: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    archived: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Every note the current filters select, as a zip of markdown files.

    The same filters the listing takes, minus paging: what you are looking at is what you get. No
    limit — an export that silently stopped at the first fifty notes would be worse than no export,
    and the archive is spooled to disk rather than held in memory, so size is bounded by the disk
    the container already has.
    """
    notes = (
        _visible_notes(db, user, q=q, date_from=date_from, date_to=date_to, archived=archived)
        .order_by(Note.id)
        .all()
    )
    if tag:
        needle = tag.strip().lower()
        notes = [n for n in notes if needle in (n.tags or [])]

    buffer = write_zip(notes)

    def stream():
        try:
            while chunk := buffer.read(ZIP_CHUNK_BYTES):
                yield chunk
        finally:
            buffer.close()

    return StreamingResponse(
        stream(),
        media_type="application/zip",
        headers={"Content-Disposition": _attachment("notes.zip")},
    )


@router.get("/{note_id}", response_model=NoteOut)
def get_note(
    note_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Note:
    return _own_note_or_404(note_id, user, db)


@router.put("/{note_id}", response_model=NoteOut)
def update_note(
    note_id: int,
    payload: NoteIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Note:
    note = _own_note_or_404(note_id, user, db)
    note.title = payload.title
    note.content = payload.content
    note.tags = _normalize_tags(payload.tags)
    note.note_date = payload.note_date
    db.commit()
    db.refresh(note)
    return note


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(
    note_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    note = _own_note_or_404(note_id, user, db)
    db.delete(note)
    db.commit()


@router.post("/{note_id}/archive", response_model=NoteOut)
def archive_note(
    note_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Note:
    note = _own_note_or_404(note_id, user, db)
    if note.archived_at is None:
        note.archived_at = _now()
        db.commit()
        db.refresh(note)
    return note


@router.post("/{note_id}/unarchive", response_model=NoteOut)
def unarchive_note(
    note_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Note:
    note = _own_note_or_404(note_id, user, db)
    if note.archived_at is not None:
        note.archived_at = None
        db.commit()
        db.refresh(note)
    return note


@router.post("/{note_id}/pin", response_model=NoteOut)
def pin_note(
    note_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Note:
    note = _own_note_or_404(note_id, user, db)
    if note.pinned_at is None:
        note.pinned_at = _now()
        db.commit()
        db.refresh(note)
    return note


@router.post("/{note_id}/unpin", response_model=NoteOut)
def unpin_note(
    note_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Note:
    note = _own_note_or_404(note_id, user, db)
    if note.pinned_at is not None:
        note.pinned_at = None
        db.commit()
        db.refresh(note)
    return note


@router.post("/{note_id}/share", response_model=ShareOut)
def share_note(
    note_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Note:
    """Publish a read-only link, or return the one this note already has.

    Idempotent on purpose: pressing Share twice must not mint a second token and silently break
    the link that was already copied into a chat.
    """
    note = _own_note_or_404(note_id, user, db)
    if note.share_token is None:
        note.share_token = secrets.token_urlsafe(SHARE_TOKEN_BYTES)
        note.shared_at = _now()
        db.commit()
        db.refresh(note)
    return note


@router.delete("/{note_id}/share", status_code=status.HTTP_204_NO_CONTENT)
def unshare_note(
    note_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Revoke the link for good. Sharing again mints a new token rather than reviving this one."""
    note = _own_note_or_404(note_id, user, db)
    note.share_token = None
    note.shared_at = None
    db.commit()


@router.get("/{note_id}/export")
def export_note(
    note_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """One note as a markdown file, named after its title."""
    note = _own_note_or_404(note_id, user, db)
    filename = filenames_for([note])[note.id]
    return Response(
        content=to_markdown(note),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": _attachment(filename)},
    )
