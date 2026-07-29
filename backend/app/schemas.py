from datetime import date, datetime, time
from zoneinfo import available_timezones

from pydantic import BaseModel, ConfigDict, Field, field_validator

_KNOWN_TIMEZONES = frozenset(available_timezones())


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)


class UserOut(BaseModel):
    id: int
    username: str
    model_config = ConfigDict(from_attributes=True)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class NoteIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = ""
    tags: list[str] = []
    note_date: date | None = None


class NoteOut(BaseModel):
    id: int
    title: str
    content: str
    tags: list[str]
    note_date: date | None
    archived_at: datetime | None
    pinned_at: datetime | None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class NotesPage(BaseModel):
    items: list[NoteOut]
    total: int
    limit: int
    offset: int


class CalendarDay(BaseModel):
    date: date
    note_ids: list[int]


class BulkDeleteIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=200)


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=128)


class DeleteAccountIn(BaseModel):
    password: str


class OkOut(BaseModel):
    ok: bool = True


class AccountSettingsOut(BaseModel):
    timezone: str
    reminder_time: time
    notifications_enabled: bool
    telegram_linked: bool
    telegram_username: str | None
    bot_configured: bool


class AccountSettingsIn(BaseModel):
    timezone: str | None = None
    reminder_time: time | None = None
    notifications_enabled: bool | None = None

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str | None) -> str | None:
        if value is not None and value not in _KNOWN_TIMEZONES:
            raise ValueError("Unknown IANA timezone")
        return value


class TelegramLinkOut(BaseModel):
    deep_link_url: str
    expires_at: datetime
