from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
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

    # Telegram reminders
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", server_default="UTC")
    telegram_chat_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    telegram_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=func.false()
    )
    telegram_link_code: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    telegram_link_code_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    notes: Mapped[list["Note"]] = relationship(back_populates="owner", cascade="all, delete-orphan")


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    note_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    public_token: Mapped[str | None] = mapped_column(
        String(32), nullable=True, unique=True, index=True
    )
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


class ReminderSent(Base):
    """Idempotency ledger: one row per reminder actually delivered.

    The unique (note_id, note_date) pair guarantees a note's reminder is sent at
    most once for a given date, even across worker restarts or overlapping ticks.
    Editing a note's date to a new day makes it eligible again.
    """

    __tablename__ = "reminders_sent"
    __table_args__ = (UniqueConstraint("note_id", "note_date", name="uq_reminders_sent_note_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), index=True)
    note_date: Mapped[date] = mapped_column(Date)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
