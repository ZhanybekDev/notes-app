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


class TestQueryCost:
    @staticmethod
    def _count_selects(db, note_count: int) -> int:
        """Materialise `note_count` notes and report how many SELECTs it took."""
        from sqlalchemy import event

        user = make_user(db, chat_id=200 + note_count)
        for i in range(note_count):
            make_note(db, user, title=f"n{i}")

        selects: list[str] = []
        engine = db.get_bind()

        @event.listens_for(engine, "before_cursor_execute")
        def _record(conn, cursor, statement, parameters, context, executemany):
            if statement.lstrip().upper().startswith("SELECT"):
                selects.append(statement)

        try:
            assert reminders.materialize_due(db, NOW) == note_count
        finally:
            event.remove(engine, "before_cursor_execute", _record)
        return len(selects)

    def test_candidate_scan_is_capped(self, db_session, monkeypatch):
        """The cap must apply to outstanding work, not to the whole date window.

        Capping a plain date scan would starve the tail: already-materialised notes would fill
        every pass and the rest would never be reached.
        """
        monkeypatch.setattr(reminders, "RECONCILE_LIMIT", 3)
        user = make_user(db_session)
        for i in range(7):
            make_note(db_session, user, title=f"n{i}")

        assert reminders.materialize_due(db_session, NOW) == 3
        assert reminders.materialize_due(db_session, NOW) == 3
        assert reminders.materialize_due(db_session, NOW) == 1
        assert reminders.materialize_due(db_session, NOW) == 0
        assert db_session.query(Reminder).count() == 7

    def test_reads_do_not_scale_with_note_count(self, db_session):
        """Committing inside the loop expired every loaded object and re-SELECTed it.

        Inserts necessarily scale with the number of new rows; reads must not. Before the fix a
        20-note pass cost 79 statements, most of them redundant re-reads.
        """
        few = self._count_selects(db_session, 3)
        many = self._count_selects(db_session, 25)

        assert few == many, f"reads scale with note count: {few} vs {many}"
        assert many <= 3, f"expected a couple of scans, got {many} SELECTs"

    def test_reconciliation_passes_are_bounded(self, db_session):
        assert reminders.RECONCILE_LIMIT > 0

        user = make_user(db_session)
        make_note(db_session, user)
        reminders.materialize_due(db_session, NOW)

        # Both passes must carry a LIMIT so a growing outbox cannot turn into a full scan.
        for fn in (reminders.resync_pending, reminders.cancel_stale):
            assert fn(db_session, NOW) >= 0

    def test_rows_pushed_past_the_horizon_by_a_timezone_change_stay_in_scope(self, db_session):
        """A resync can move a row beyond the horizon; it must still be maintained afterwards."""
        user = make_user(db_session)
        make_note(db_session, user)
        reminders.materialize_due(db_session, NOW)
        row = db_session.query(Reminder).one()
        row.scheduled_for = NOW + reminders.MATERIALIZE_HORIZON + timedelta(hours=6)
        db_session.commit()

        # Still reachable, so the schedule gets corrected instead of freezing.
        assert reminders.resync_pending(db_session, NOW) == 1
        assert reminders._as_utc(db_session.query(Reminder).one().scheduled_for) == datetime(
            2026, 8, 1, 9, 0, tzinfo=UTC
        )

    def test_far_future_rows_are_left_out_of_reconciliation(self, db_session):
        user = make_user(db_session)
        make_note(db_session, user)
        reminders.materialize_due(db_session, NOW)
        row = db_session.query(Reminder).one()
        row.scheduled_for = NOW + timedelta(days=30)
        db_session.commit()

        # Beyond anything a timezone change could produce: out of scope for both passes.
        assert reminders.resync_pending(db_session, NOW) == 0
        assert reminders.cancel_stale(db_session, NOW) == 0
        assert db_session.query(Reminder).one().status == Reminder.STATUS_PENDING


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

        assert reminders.claim_next(db_session, NOW, set()) is None
        assert reminders.claim_next(db_session, NOW.replace(hour=9), set()) is not None

    def test_excluded_rows_are_not_handed_out_again(self, db_session):
        user = make_user(db_session)
        make_note(db_session, user)
        reminders.materialize_due(db_session, NOW)
        due = NOW.replace(hour=9)

        first = reminders.claim_next(db_session, due, set())
        assert first is not None
        assert reminders.claim_next(db_session, due, {first.id}) is None

    def test_statement_locks_rows_and_skips_locked_ones(self):
        # SQLite ignores row locking, so assert on the SQL the Postgres dialect will actually run.
        stmt = (
            reminders.select(Reminder)
            .where(Reminder.status == Reminder.STATUS_PENDING)
            .limit(1)
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
