from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..config import settings
from ..deps import get_current_user, get_db
from ..models import User
from ..reminders import issue_link_code
from ..schemas import OkOut, TelegramRemindersIn, TelegramStatusOut, TimezoneIn
from ..telegram import build_link_url, resolve_bot_username

router = APIRouter(prefix="/account/telegram", tags=["telegram"])


def _status(user: User, *, link_url: str | None = None) -> TelegramStatusOut:
    return TelegramStatusOut(
        linked=user.telegram_chat_id is not None,
        enabled=user.telegram_enabled,
        timezone=user.timezone,
        bot_configured=settings.telegram_configured,
        link_url=link_url,
    )


@router.get("", response_model=TelegramStatusOut)
def get_status(user: User = Depends(get_current_user)) -> TelegramStatusOut:
    return _status(user)


@router.post("/link", response_model=TelegramStatusOut)
def link(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TelegramStatusOut:
    if not settings.telegram_configured:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Telegram bot is not configured on the server",
        )
    username = resolve_bot_username()
    if not username:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Could not resolve the Telegram bot username",
        )
    code = issue_link_code(db, user)
    return _status(user, link_url=build_link_url(username, code))


@router.delete("", response_model=OkOut)
def unlink(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OkOut:
    user.telegram_chat_id = None
    user.telegram_enabled = False
    user.telegram_link_code = None
    user.telegram_link_code_expires_at = None
    db.commit()
    return OkOut()


@router.put("/reminders", response_model=TelegramStatusOut)
def set_reminders(
    payload: TelegramRemindersIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TelegramStatusOut:
    if payload.enabled and user.telegram_chat_id is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Link a Telegram account before enabling reminders",
        )
    user.telegram_enabled = payload.enabled
    db.commit()
    return _status(user)


@router.put("/timezone", response_model=TelegramStatusOut)
def set_timezone(
    payload: TimezoneIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TelegramStatusOut:
    try:
        ZoneInfo(payload.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown timezone") from None
    user.timezone = payload.timezone
    db.commit()
    return _status(user)
