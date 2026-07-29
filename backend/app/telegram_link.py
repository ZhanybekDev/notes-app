"""Binding a Telegram chat to an account.

Account work only. What the user reads lives in `bot_commands`, so there is one place to look for
the wording and one place to look for the state change.

Lives in `app/` rather than `scripts/` on purpose: pytest measures `--cov=app`, so anything left
inside the worker process is invisible to the coverage gate.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from enum import Enum

from sqlalchemy.orm import Session

from .models import User

LINK_CODE_TTL = timedelta(minutes=15)
_LINK_CODE_BYTES = 32


class LinkResult(Enum):
    """What redeeming a code did. The wording that reaches the user belongs to bot_commands."""

    LINKED = "linked"
    UNKNOWN_OR_EXPIRED = "unknown_or_expired"
    CHAT_TAKEN = "chat_taken"


def _now() -> datetime:
    return datetime.now(UTC)


def issue_link_code(db: Session, user: User) -> tuple[str, datetime]:
    """Replace any previous code so only the newest deep link stays valid."""
    code = secrets.token_urlsafe(_LINK_CODE_BYTES)
    expires_at = _now() + LINK_CODE_TTL
    user.telegram_link_code = code
    user.telegram_link_code_expires_at = expires_at
    db.commit()
    return code, expires_at


def unlink(db: Session, user: User) -> None:
    user.telegram_chat_id = None
    user.telegram_username = None
    user.telegram_language = None
    user.telegram_linked_at = None
    user.telegram_link_code = None
    user.telegram_link_code_expires_at = None
    user.notifications_enabled = False
    db.commit()


def user_for_chat(db: Session, chat_id: int) -> User | None:
    return db.query(User).filter(User.telegram_chat_id == chat_id).one_or_none()


def _expired(user: User, now: datetime) -> bool:
    expires_at = user.telegram_link_code_expires_at
    if expires_at is None:
        return True
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return expires_at < now


def redeem_code(
    db: Session,
    *,
    code: str,
    chat_id: int,
    telegram_username: str | None,
    language: str,
) -> tuple[LinkResult, User | None]:
    """Bind a chat to the account that owns `code`."""
    user = db.query(User).filter(User.telegram_link_code == code).one_or_none()
    now = _now()
    if user is None or _expired(user, now):
        return LinkResult.UNKNOWN_OR_EXPIRED, None

    taken_by = (
        db.query(User).filter(User.telegram_chat_id == chat_id, User.id != user.id).one_or_none()
    )
    if taken_by is not None:
        return LinkResult.CHAT_TAKEN, None

    user.telegram_chat_id = chat_id
    user.telegram_username = telegram_username
    # Stored so reminders sent days later speak the same language as the confirmation.
    user.telegram_language = language
    user.telegram_linked_at = now
    user.telegram_link_code = None
    user.telegram_link_code_expires_at = None
    # Linking with notifications left off would leave the user waiting for messages that
    # never come; unlink() mirrors this by turning them back off.
    user.notifications_enabled = True
    db.commit()
    return LinkResult.LINKED, user
