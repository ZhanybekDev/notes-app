"""Unauthenticated reads of shared notes.

Its own module rather than a branch inside `notes.py`, because everything in that file is behind
`get_current_user` and a reader of it is entitled to assume so. A separate router makes the one
exception visible in the file tree.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import Note
from ..rate_limit import check_public_rate_limit
from ..schemas import PublicNoteOut

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/notes/{token}", response_model=PublicNoteOut)
def read_shared_note(
    token: str,
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
) -> Note:
    """Resolve a share token.

    Every rejection is the same 404 with the same body: a revoked link, a token that never existed
    and an archived note must be indistinguishable, or the difference itself answers questions
    about notes the reader has no business asking about.

    Archived notes stop resolving. Archiving is how this app expresses "put away", and a link that
    kept working afterwards would be a copy of the note that outlives the decision to hide it.
    """
    check_public_rate_limit(request)
    # Search engines find links pasted in public places; a note the owner shared with one person
    # should not become a result page.
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    # Not cached by proxies: revocation has to take effect the moment it is pressed.
    response.headers["Cache-Control"] = "no-store"

    note = db.query(Note).filter(Note.share_token == token).one_or_none()
    if note is None or note.archived_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    return note
