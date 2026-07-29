from fastapi import APIRouter, Depends, HTTPException, Request, status
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
    AccountSettingsIn,
    AccountSettingsOut,
    ChangePasswordIn,
    DeleteAccountIn,
    OkOut,
    TelegramLinkOut,
)
from ..telegram_link import issue_link_code, unlink

router = APIRouter(prefix="/account", tags=["account"])


def _settings_out(user: User) -> AccountSettingsOut:
    return AccountSettingsOut(
        timezone=user.timezone,
        reminder_time=user.reminder_time,
        notifications_enabled=user.notifications_enabled,
        telegram_linked=user.telegram_chat_id is not None,
        telegram_username=user.telegram_username,
        bot_configured=settings.bot_configured,
    )


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


@router.get("/settings", response_model=AccountSettingsOut)
def get_settings(user: User = Depends(get_current_user)) -> AccountSettingsOut:
    return _settings_out(user)


@router.patch("/settings", response_model=AccountSettingsOut)
def update_settings(
    payload: AccountSettingsIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AccountSettingsOut:
    fields = payload.model_dump(exclude_unset=True)
    for field, value in fields.items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return _settings_out(user)


@router.post("/telegram/link", response_model=TelegramLinkOut)
def create_telegram_link(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TelegramLinkOut:
    if not settings.bot_configured:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Telegram bot is not configured on this deployment",
        )
    code, expires_at = issue_link_code(db, user)
    return TelegramLinkOut(
        deep_link_url=f"https://t.me/{settings.telegram_bot_username}?start={code}",
        expires_at=expires_at,
    )


@router.delete("/telegram", status_code=status.HTTP_204_NO_CONTENT)
def delete_telegram_link(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    unlink(db, user)


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
