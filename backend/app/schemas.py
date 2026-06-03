from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


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
    public_token: str | None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class SharedNoteOut(BaseModel):
    """Public, read-only projection of a note - deliberately omits ids and owner."""

    title: str
    content: str
    tags: list[str]
    note_date: date | None
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class ShareOut(BaseModel):
    token: str


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


class TelegramStatusOut(BaseModel):
    linked: bool
    enabled: bool
    timezone: str
    bot_configured: bool
    link_url: str | None = None


class TelegramRemindersIn(BaseModel):
    enabled: bool


class TimezoneIn(BaseModel):
    timezone: str = Field(min_length=1, max_length=64)
