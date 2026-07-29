"""Domain logic for binding a Telegram chat to an account.

Lives in `app/` rather than `scripts/` on purpose: pytest measures `--cov=app`, so anything
left inside the worker process is invisible to the coverage gate.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from .models import User

LINK_CODE_TTL = timedelta(minutes=15)
_LINK_CODE_BYTES = 32


@dataclass(frozen=True)
class LinkOutcome:
    """What the worker should reply with, and whether anything was persisted."""

    linked: bool
    reply: str
    username: str | None = None


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
    user.telegram_linked_at = None
    user.telegram_link_code = None
    user.telegram_link_code_expires_at = None
    user.notifications_enabled = False
    db.commit()


def parse_start_command(text: str | None) -> str | None:
    """Return the payload of `/start <code>`, or None if this is not such a command."""
    if not text:
        return None
    parts = text.strip().split(maxsplit=1)
    if not parts or parts[0].split("@")[0] != "/start":
        return None
    return parts[1].strip() if len(parts) > 1 and parts[1].strip() else None


def _expired(user: User, now: datetime) -> bool:
    expires_at = user.telegram_link_code_expires_at
    if expires_at is None:
        return True
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return expires_at < now


def handle_start_command(db: Session, update: dict[str, Any]) -> LinkOutcome | None:
    """Bind a chat to the account that owns the code carried by `/start`.

    Returns None when the update is not a `/start` we should answer at all.
    """
    message = update.get("message") or {}
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    if not isinstance(chat_id, int):
        return None

    code = parse_start_command(message.get("text"))
    if code is None:
        return LinkOutcome(
            linked=False,
            reply="Open Settings in the Notes app and press “Connect Telegram” to link this chat.",
        )

    user = db.query(User).filter(User.telegram_link_code == code).one_or_none()
    now = _now()
    if user is None or _expired(user, now):
        return LinkOutcome(
            linked=False,
            reply="This link is unknown or has expired. Generate a new one in Settings.",
        )

    taken_by = (
        db.query(User).filter(User.telegram_chat_id == chat_id, User.id != user.id).one_or_none()
    )
    if taken_by is not None:
        return LinkOutcome(
            linked=False,
            reply="This Telegram account is already connected to another Notes account.",
        )

    telegram_username = (message.get("from") or {}).get("username")
    user.telegram_chat_id = chat_id
    user.telegram_username = telegram_username
    user.telegram_linked_at = now
    user.telegram_link_code = None
    user.telegram_link_code_expires_at = None
    # Linking with notifications left off would leave the user waiting for messages that
    # never come; unlink() mirrors this by turning them back off.
    user.notifications_enabled = True
    db.commit()

    return LinkOutcome(
        linked=True,
        reply=f"Connected to “{user.username}”. Reminders will arrive here.",
        username=telegram_username,
    )
