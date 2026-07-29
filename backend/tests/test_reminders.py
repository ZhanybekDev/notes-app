from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy.dialects import postgresql

from app import reminders
from app.models import Note, Reminder, User

NOW = datetime(2026, 8, 1, 6, 0, tzinfo=UTC)


def make_user(db, *, tz="UTC", reminder_time=time(9, 0), enabled=True, chat_id=100) -> User:
    user = User(
        username=f"u{chat_id}",
        password_hash="x",
        timezone=tz,
        reminder_time=reminder_time,
        notifications_enabled=enabled,
        telegram_chat_id=chat_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def make_note(db, user, *, note_date=date(2026, 8, 1), archived=False, title="Standup") -> Note:
    note = Note(
        user_id=user.id,
        title=title,
        content="Prepare the agenda",
        tags=[],
        note_date=note_date,
        archived_at=datetime(2026, 7, 1, tzinfo=UTC) if archived else None,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


class TestComputeScheduledFor:
    def test_positive_offset(self):
        assert reminders.compute_scheduled_for(
            date(2026, 8, 1), "Asia/Bishkek", time(9, 0)
        ) == datetime(2026, 8, 1, 3, 0, tzinfo=UTC)

    def test_negative_offset(self):
        assert reminders.compute_scheduled_for(
            date(2026, 8, 1), "America/New_York", time(9, 0)
        ) == datetime(2026, 8, 1, 13, 0, tzinfo=UTC)

    def test_utc(self):
        assert reminders.compute_scheduled_for(date(2026, 8, 1), "UTC", time(9, 0)) == datetime(
            2026, 8, 1, 9, 0, tzinfo=UTC
        )

    def test_dst_gap_local_time_that_does_not_exist(self):
        # 2026-03-29 02:30 never happens in Berlin; zoneinfo resolves it deterministically.
        assert reminders.compute_scheduled_for(
            date(2026, 3, 29), "Europe/Berlin", time(2, 30)
        ) == datetime(2026, 3, 29, 1, 30, tzinfo=UTC)

    def test_dst_overlap_local_time_that_happens_twice(self):
        assert reminders.compute_scheduled_for(
            date(2026, 10, 25), "Europe/Berlin", time(2, 30)
        ) == datetime(2026, 10, 25, 0, 30, tzinfo=UTC)


class TestMaterialize:
    def test_creates_one_row(self, db_session):
        user = make_user(db_session, tz="Asia/Bishkek")
        note = make_note(db_session, user)

        assert reminders.materialize_due(db_session, NOW) == 1

        row = db_session.query(Reminder).one()
        assert row.note_id == note.id
        assert row.note_date == date(2026, 8, 1)
        assert row.status == Reminder.STATUS_PENDING
        assert reminders._as_utc(row.scheduled_for) == datetime(2026, 8, 1, 3, 0, tzinfo=UTC)

    def test_is_idempotent(self, db_session):
        user = make_user(db_session)
        make_note(db_session, user)

        reminders.materialize_due(db_session, NOW)
        reminders.materialize_due(db_session, NOW)

        assert db_session.query(Reminder).count() == 1

    def test_skips_archived_note(self, db_session):
        user = make_user(db_session)
        make_note(db_session, user, archived=True)

        assert reminders.materialize_due(db_session, NOW) == 0

    def test_skips_disabled_notifications(self, db_session):
        user = make_user(db_session, enabled=False)
        make_note(db_session, user)

        assert reminders.materialize_due(db_session, NOW) == 0

    def test_skips_unlinked_telegram(self, db_session):
        user = make_user(db_session, chat_id=None)
        make_note(db_session, user)

        assert reminders.materialize_due(db_session, NOW) == 0

    def test_skips_note_without_date(self, db_session):
        user = make_user(db_session)
        make_note(db_session, user, note_date=None)

        assert reminders.materialize_due(db_session, NOW) == 0

    def test_skips_note_older_than_backfill_window(self, db_session):
        user = make_user(db_session)
        make_note(db_session, user, note_date=date(2026, 7, 20))

        assert reminders.materialize_due(db_session, NOW) == 0

    def test_skips_note_beyond_horizon(self, db_session):
        user = make_user(db_session)
        make_note(db_session, user, note_date=date(2026, 9, 1))

        assert reminders.materialize_due(db_session, NOW) == 0

    def test_revives_cancelled_row_when_conditions_return(self, db_session):
        user = make_user(db_session)
        note = make_note(db_session, user)
        reminders.materialize_due(db_session, NOW)

        note.note_date = date(2026, 8, 2)
        db_session.commit()
        reminders.cancel_stale(db_session, NOW)
        assert db_session.query(Reminder).one().status == Reminder.STATUS_CANCELLED

        note.note_date = date(2026, 8, 1)
        db_session.commit()
        reminders.materialize_due(db_session, NOW)

        rows = db_session.query(Reminder).all()
        assert len(rows) == 1
        assert rows[0].status == Reminder.STATUS_PENDING

    def test_never_revives_a_sent_row(self, db_session):
        user = make_user(db_session)
        note = make_note(db_session, user)
        reminders.materialize_due(db_session, NOW)
        row = db_session.query(Reminder).one()
        reminders.mark_sent(db_session, row, NOW)

        note.note_date = date(2026, 8, 2)
        db_session.commit()
        note.note_date = date(2026, 8, 1)
        db_session.commit()
        reminders.materialize_due(db_session, NOW)

        rows = db_session.query(Reminder).all()
        assert len(rows) == 1
        assert rows[0].status == Reminder.STATUS_SENT


class TestResync:
    def test_timezone_change_updates_the_same_row(self, db_session):
        user = make_user(db_session, tz="UTC")
        make_note(db_session, user)
        reminders.materialize_due(db_session, NOW)

        user.timezone = "Asia/Bishkek"
        db_session.commit()
        assert reminders.resync_pending(db_session, NOW) == 1

        rows = db_session.query(Reminder).all()
        assert len(rows) == 1
        assert reminders._as_utc(rows[0].scheduled_for) == datetime(2026, 8, 1, 3, 0, tzinfo=UTC)

    def test_reminder_time_change_updates_the_same_row(self, db_session):
        user = make_user(db_session)
        make_note(db_session, user)
        reminders.materialize_due(db_session, NOW)

        user.reminder_time = time(7, 30)
        db_session.commit()
        reminders.resync_pending(db_session, NOW)

        rows = db_session.query(Reminder).all()
        assert len(rows) == 1
        assert reminders._as_utc(rows[0].scheduled_for) == datetime(2026, 8, 1, 7, 30, tzinfo=UTC)

    def test_no_change_is_a_noop(self, db_session):
        user = make_user(db_session)
        make_note(db_session, user)
        reminders.materialize_due(db_session, NOW)

        assert reminders.resync_pending(db_session, NOW) == 0


class TestCancelStale:
    def _pending(self, db_session, **user_kwargs):
        user = make_user(db_session, **user_kwargs)
        note = make_note(db_session, user)
        reminders.materialize_due(db_session, NOW)
        return user, note

    def test_archived_note(self, db_session):
        _, note = self._pending(db_session)
        note.archived_at = NOW
        db_session.commit()

        assert reminders.cancel_stale(db_session, NOW) == 1
        assert db_session.query(Reminder).one().status == Reminder.STATUS_CANCELLED

    def test_date_cleared(self, db_session):
        _, note = self._pending(db_session)
        note.note_date = None
        db_session.commit()

        assert reminders.cancel_stale(db_session, NOW) == 1

    def test_date_moved(self, db_session):
        _, note = self._pending(db_session)
        note.note_date = date(2026, 8, 2)
        db_session.commit()

        assert reminders.cancel_stale(db_session, NOW) == 1

    def test_notifications_disabled(self, db_session):
        user, _ = self._pending(db_session)
        user.notifications_enabled = False
        db_session.commit()

        assert reminders.cancel_stale(db_session, NOW) == 1

    def test_telegram_unlinked(self, db_session):
        user, _ = self._pending(db_session)
        user.telegram_chat_id = None
        db_session.commit()

        assert reminders.cancel_stale(db_session, NOW) == 1

    def test_scheduled_time_went_stale(self, db_session):
        self._pending(db_session)

        # Worker was down for two days; yesterday's reminder must not fire now.
        assert reminders.cancel_stale(db_session, NOW + timedelta(days=2)) == 1

    def test_healthy_row_survives(self, db_session):
        self._pending(db_session)

        assert reminders.cancel_stale(db_session, NOW) == 0


class TestClaim:
    def test_returns_only_due_rows(self, db_session):
        user = make_user(db_session)
        make_note(db_session, user)
        reminders.materialize_due(db_session, NOW)

        assert reminders.claim_batch(db_session, NOW) == []
        assert len(reminders.claim_batch(db_session, NOW.replace(hour=9))) == 1

    def test_statement_locks_rows_and_skips_locked_ones(self):
        # SQLite ignores row locking, so assert on the SQL the Postgres dialect will actually run.
        stmt = (
            reminders.select(Reminder)
            .where(Reminder.status == Reminder.STATUS_PENDING)
            .with_for_update(skip_locked=True)
        )
        sql = str(stmt.compile(dialect=postgresql.dialect()))

        assert "FOR UPDATE" in sql
        assert "SKIP LOCKED" in sql


class TestMarking:
    def test_mark_sent(self, db_session):
        user = make_user(db_session)
        make_note(db_session, user)
        reminders.materialize_due(db_session, NOW)
        row = db_session.query(Reminder).one()

        reminders.mark_sent(db_session, row, NOW)

        assert row.status == Reminder.STATUS_SENT
        assert row.attempts == 1
        assert row.sent_at is not None

    def test_failures_stay_pending_until_the_cap(self, db_session):
        user = make_user(db_session)
        make_note(db_session, user)
        reminders.materialize_due(db_session, NOW)
        row = db_session.query(Reminder).one()

        for _ in range(reminders.MAX_ATTEMPTS - 1):
            reminders.mark_failed(db_session, row, "boom")
        assert row.status == Reminder.STATUS_PENDING

        reminders.mark_failed(db_session, row, "boom")
        assert row.status == Reminder.STATUS_FAILED
        assert row.last_error == "boom"


class TestRenderMessage:
    def test_includes_title_date_and_excerpt(self, db_session):
        user = make_user(db_session)
        note = make_note(db_session, user)

        text = reminders.render_message(note)

        assert "Standup" in text
        assert "2026-08-01" in text
        assert "Prepare the agenda" in text

    def test_long_content_is_truncated(self, db_session):
        user = make_user(db_session)
        note = make_note(db_session, user)
        note.content = "word " * 500
        db_session.commit()

        text = reminders.render_message(note)

        assert len(text) < 400
        assert text.endswith("…")

    def test_empty_content_still_renders(self, db_session):
        user = make_user(db_session)
        note = make_note(db_session, user)
        note.content = ""
        db_session.commit()

        assert "Standup" in reminders.render_message(note)
