import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db
from ..models import Note, User
from ..schemas import OkOut, SharedNoteOut, ShareOut

router = APIRouter(tags=["share"])


def _own_note_or_404(note_id: int, user: User, db: Session) -> Note:
    note = db.get(Note, note_id)
    if note is None or note.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")
    return note


@router.post("/notes/{note_id}/share", response_model=ShareOut)
def share_note(
    note_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ShareOut:
    note = _own_note_or_404(note_id, user, db)
    if not note.public_token:
        note.public_token = secrets.token_urlsafe(16)
        db.commit()
    return ShareOut(token=note.public_token)


@router.delete("/notes/{note_id}/share", response_model=OkOut)
def unshare_note(
    note_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OkOut:
    note = _own_note_or_404(note_id, user, db)
    note.public_token = None
    db.commit()
    return OkOut()


@router.get("/share/{token}", response_model=SharedNoteOut)
def get_shared_note(token: str, db: Session = Depends(get_db)) -> Note:
    """Public read-only view. No auth: anyone with the token can read the note."""
    note = db.query(Note).filter(Note.public_token == token).first()
    if note is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Shared note not found")
    return note
