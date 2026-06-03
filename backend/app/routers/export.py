import io
import re
import zipfile
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db
from ..models import Note, User

router = APIRouter(prefix="/export", tags=["export"])


def _slugify(value: str, fallback: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or fallback


def _timestamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%d-%H%M%S")


def note_to_markdown(note: Note) -> str:
    meta = [f"# {note.title}", ""]
    if note.note_date is not None:
        meta.append(f"- Date: {note.note_date.isoformat()}")
    if note.tags:
        meta.append(f"- Tags: {', '.join(note.tags)}")
    meta.append("")
    return "\n".join(meta) + (note.content or "") + "\n"


@router.get("/note/{note_id}")
def export_note(
    note_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    note = db.get(Note, note_id)
    if note is None or note.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")
    filename = f"{_slugify(note.title, f'note-{note.id}')}-{_timestamp()}.md"
    return Response(
        content=note_to_markdown(note),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/notes")
def export_all(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    notes = db.query(Note).filter(Note.user_id == user.id).order_by(Note.id.asc()).all()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for note in notes:
            name = f"{note.id:04d}-{_slugify(note.title, f'note-{note.id}')}.md"
            zf.writestr(name, note_to_markdown(note))
    buf.seek(0)
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="notes-{_timestamp()}.zip"'},
    )
