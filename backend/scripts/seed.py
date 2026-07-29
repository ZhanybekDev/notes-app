"""Seed a demo user with a few notes.

Idempotent, and deliberately non-destructive about the account itself: re-seeding replaces the
notes but keeps the Telegram binding and the reminder preferences. Deleting the user, which is
what this used to do, meant every `make seed` silently un-linked the bot and sent whoever was
testing back to Telegram to press Start again.
"""

from datetime import date, time, timedelta

from app.auth import hash_password
from app.db import SessionLocal
from app.models import Note, User

DEMO_USERNAME = "demo"
DEMO_PASSWORD = "demo1234"


def seed() -> None:
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == DEMO_USERNAME).one_or_none()
        if user is None:
            user = User(
                username=DEMO_USERNAME,
                password_hash=hash_password(DEMO_PASSWORD),
                timezone="UTC",
                reminder_time=time(9, 0),
            )
            db.add(user)
        else:
            # Only the password is forced back, so the credentials in the README stay true.
            # Everything else on the account is the tester's, not ours.
            user.password_hash = hash_password(DEMO_PASSWORD)
            db.query(Note).filter(Note.user_id == user.id).delete(synchronize_session=False)
        db.flush()

        today = date.today()
        notes: list[Note] = [
            Note(
                user_id=user.id,
                title="Welcome",
                content="# Welcome\n\nThis is your first note. Edit me, or create new ones.",
                tags=["intro"],
                note_date=None,
            ),
            Note(
                user_id=user.id,
                title="Grocery list",
                content="- milk\n- bread\n- eggs",
                tags=["todo", "shopping"],
                note_date=today,
            ),
            Note(
                user_id=user.id,
                title="Project kickoff",
                content="Meeting with the team **tomorrow**. Prepare the agenda.",
                tags=["work"],
                note_date=today + timedelta(days=1),
            ),
            Note(
                user_id=user.id,
                title="Book idea",
                content="_Fleeting thought worth keeping._",
                tags=["ideas"],
                note_date=None,
            ),
            Note(
                user_id=user.id,
                title="Reminder demo",
                content=(
                    "Dated today. Connect Telegram in Settings, set the reminder time a "
                    "minute ahead, and this note is what the bot sends."
                ),
                tags=["demo"],
                note_date=today,
            ),
        ]
        db.add_all(notes)
        db.commit()
        linked = "linked" if user.telegram_chat_id else "not linked"
        print(
            f"Seeded '{DEMO_USERNAME}' / '{DEMO_PASSWORD}' with {len(notes)} notes. "
            f"Telegram: {linked}."
        )
    finally:
        db.close()


if __name__ == "__main__":
    seed()
