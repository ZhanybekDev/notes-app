import secrets
import string
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import hash_password, verify_password
from ..config import settings
from ..deps import get_current_user, get_db
from ..models import User
from ..rate_limit import (
    auth_rate_limit_key,
    check_auth_rate_limit,
    clear_auth_failures,
    record_auth_failure,
)
from ..schemas import (
    ChangePasswordIn,
    DeleteAccountIn,
    OkOut,
    TelegramLinkOut,
    TelegramSettingsIn,
    TelegramSettingsOut,
)

router = APIRouter(prefix="/account", tags=["account"])

_TELEGRAM_LINK_CODE_TTL = timedelta(minutes=15)
_TELEGRAM_CODE_ALPHABET = string.ascii_uppercase + string.digits


def _telegram_available() -> bool:
    return bool(settings.telegram_bot_token)


def _telegram_settings_out(user: User) -> TelegramSettingsOut:
    connected = bool(user.telegram_chat_id)
    return TelegramSettingsOut(
        available=_telegram_available(),
        connected=connected,
        telegram_username=user.telegram_username,
        notifications_enabled=bool(connected and user.telegram_notifications_enabled),
        link_code=user.telegram_link_code,
        link_code_expires_at=user.telegram_link_code_expires_at,
    )


def _telegram_link_out(user: User) -> TelegramLinkOut:
    return TelegramLinkOut(**_telegram_settings_out(user).model_dump())


def _generate_link_code() -> str:
    return "".join(secrets.choice(_TELEGRAM_CODE_ALPHABET) for _ in range(8))


def _assign_unique_link_code(user: User, db: Session) -> None:
    for _ in range(10):
        code = _generate_link_code()
        exists = db.query(User.id).filter(User.telegram_link_code == code).first()
        if exists is None:
            user.telegram_link_code = code
            user.telegram_link_code_expires_at = datetime.now(UTC) + _TELEGRAM_LINK_CODE_TTL
            return
    raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Could not generate link code")


def _require_telegram_available() -> None:
    if not _telegram_available():
        raise HTTPException(status.HTTP_409_CONFLICT, "Telegram bot is unavailable")


@router.post("/change-password", response_model=OkOut)
def change_password(
    request: Request,
    payload: ChangePasswordIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OkOut:
    rate_limit_key = auth_rate_limit_key(request, "change-password", user.id)
    check_auth_rate_limit(rate_limit_key)
    if not verify_password(payload.current_password, user.password_hash):
        record_auth_failure(rate_limit_key)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Current password is wrong")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    clear_auth_failures(rate_limit_key)
    return OkOut()


@router.get("/telegram", response_model=TelegramSettingsOut)
def get_telegram_settings(user: User = Depends(get_current_user)) -> TelegramSettingsOut:
    return _telegram_settings_out(user)


@router.post("/telegram/link", response_model=TelegramLinkOut)
def generate_telegram_link(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TelegramLinkOut:
    _require_telegram_available()
    if user.telegram_chat_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Telegram is already connected")

    _assign_unique_link_code(user, db)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Could not generate link code") from None
    db.refresh(user)
    return _telegram_link_out(user)


@router.put("/telegram", response_model=TelegramSettingsOut)
def update_telegram_settings(
    payload: TelegramSettingsIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TelegramSettingsOut:
    if payload.notifications_enabled and not user.telegram_chat_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Connect Telegram before enabling reminders")

    user.telegram_notifications_enabled = bool(
        user.telegram_chat_id and payload.notifications_enabled
    )
    db.commit()
    db.refresh(user)
    return _telegram_settings_out(user)


@router.post("/telegram/unlink", response_model=TelegramSettingsOut)
def unlink_telegram(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TelegramSettingsOut:
    user.telegram_chat_id = None
    user.telegram_username = None
    user.telegram_notifications_enabled = False
    user.telegram_link_code = None
    user.telegram_link_code_expires_at = None
    db.commit()
    db.refresh(user)
    return _telegram_settings_out(user)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    request: Request,
    payload: DeleteAccountIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    rate_limit_key = auth_rate_limit_key(request, "delete-account", user.id)
    check_auth_rate_limit(rate_limit_key)
    if not verify_password(payload.password, user.password_hash):
        record_auth_failure(rate_limit_key)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Password is wrong")
    db.delete(user)
    db.commit()
    clear_auth_failures(rate_limit_key)
