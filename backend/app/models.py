from datetime import date, datetime, time

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    false,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from .db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    timezone: Mapped[str] = mapped_column(String(64), nullable=False, server_default="UTC")
    reminder_time: Mapped[time] = mapped_column(Time, nullable=False, server_default="09:00:00")
    notifications_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=false()
    )
    telegram_chat_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, unique=True)
    telegram_username: Mapped[str | None] = mapped_column(String(32), nullable=True)
    telegram_linked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    telegram_link_code: Mapped[str | None] = mapped_column(String(43), nullable=True, unique=True)
    telegram_link_code_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    notes: Mapped[list["Note"]] = relationship(back_populates="owner", cascade="all, delete-orphan")


class Note(Base):
    __tablename__ = "notes"
    __table_args__ = (
        # Composite rather than `note_date` alone: the reminder sweep scans a date range, orders
        # by `(note_date, id)` and resumes from a cursor on the same pair, so one index serves the
        # range, the sort and the seek. The leading column still covers every plain `note_date`
        # filter the API does, which is why the single-column index it replaces is redundant.
        Index("ix_notes_note_date_id", "note_date", "id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    note_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    pinned_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    owner: Mapped[User] = relationship(back_populates="notes")


class Reminder(Base):
    """Outbox row for one note on one date.

    The uniqueness key is `(note_id, note_date)` and not `(note_id, scheduled_for)` on purpose:
    `scheduled_for` is derived from the user's timezone and reminder time, so keying on it would
    let a settings change insert a second row while the first stayed pending — two messages for
    one note. `note_date` does not move when settings change.
    """

    __tablename__ = "reminders"
    __table_args__ = (
        UniqueConstraint("note_id", "note_date", name="uq_reminders_note_occurrence"),
        Index("ix_reminders_status_scheduled_for", "status", "scheduled_for"),
    )

    STATUS_PENDING = "pending"
    STATUS_SENT = "sent"
    STATUS_FAILED = "failed"
    STATUS_CANCELLED = "cancelled"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), index=True)
    note_date: Mapped[date] = mapped_column(Date, nullable=False)
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default=STATUS_PENDING)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
