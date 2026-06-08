# Next Development Plan

## Goal

The next development pass should stabilize the current app before adding larger features. The repository already has notes, calendar, Telegram linking, a bot worker, and one-shot reminders. The highest-value next step is to improve reliability, documentation accuracy, and readiness for user-specific reminder behavior.

## Priorities

### 1. Align Documentation With Current State

The current architecture already includes `bot_worker.py`, `reminders.py`, Telegram polling, and reminder delivery. The async/outbox plan still describes the repo as if it has no background job subsystem.

Tasks:

1. Update `docs/async-outbox-timezone-plan.md` to distinguish current worker behavior from the future DB outbox design.
2. Keep `docs/architecture.md` aligned with the actual compose services, backend modules, API filters, and rate limiter.
3. Treat documentation updates as part of feature delivery, not as a separate cleanup step.

Acceptance criteria:

1. Architecture docs describe the existing `bot` worker accurately.
2. Future outbox work is documented as an evolution of the current worker, not as a first worker introduction.
3. API surface docs include all supported query parameters.

### 2. Add User Timezone Preferences

Reminder behavior currently depends on a global `REMINDER_TIMEZONE`. For a multi-account notes app, reminder dates should be interpreted in the user's own timezone.

Tasks:

1. Add `users.timezone` with default `UTC`.
2. Validate timezone strings with `zoneinfo.ZoneInfo`.
3. Add account preference API endpoints:
   - `GET /api/account`
   - `PATCH /api/account/preferences`
4. Add timezone management to `frontend/src/pages/Settings.jsx`.
5. Pre-fill the UI with `Intl.DateTimeFormat().resolvedOptions().timeZone` when useful.
6. Use the note owner's timezone when selecting due reminders.

Acceptance criteria:

1. New users get `UTC` by default.
2. Users can view and update their timezone.
3. Invalid timezone strings are rejected by the backend.
4. Reminder due-date calculation no longer depends on one global timezone.

### 3. Reduce Duplicate Reminder Risk

The current reminder path sends a Telegram message and only then commits `reminder_sent_at`. If the worker crashes after the provider accepts the message but before the commit succeeds, the same reminder can be sent again.

Tasks:

1. Introduce a durable reminder delivery record or a minimal delivery lock/status model.
2. Use a stable dedupe key such as `telegram_reminder:{note_id}:{note_date}`.
3. Record the delivery attempt before provider send where possible.
4. Make repeated worker passes idempotent for the same note/date pair.
5. Add tests for duplicate worker execution.

Acceptance criteria:

1. The same note/date reminder cannot be sent twice by normal retries.
2. Worker restart does not create duplicate reminder delivery for already completed work.
3. Failed attempts are visible enough to debug.

### 4. Introduce a Small Service Layer

Routers currently own HTTP handling, validation glue, ORM queries, transaction boundaries, and business decisions. This is still acceptable for simple CRUD, but reminder delivery, timezone preferences, and idempotency need reusable service workflows.

Tasks:

1. Create `backend/app/services/`.
2. Start with focused modules instead of a broad rewrite:
   - `account_service.py`
   - `reminder_service.py`
   - later `notes_service.py`
3. Keep routers as thin HTTP adapters for new workflows.
4. Let the worker call services directly instead of duplicating business logic.

Acceptance criteria:

1. New account preference and reminder workflows live outside routers.
2. Worker code does not import routers.
3. Existing CRUD behavior remains unchanged.

### 5. Fix Calendar N+1 Requests

The calendar currently returns note IDs and the frontend fetches each note separately when a day is opened. This creates unnecessary round trips.

Tasks:

1. Either extend `/notes/calendar` to return note summaries or use one date-filtered `/notes` request when opening a day.
2. Replace `Promise.all(day.note_ids.map((id) => api.getNote(id)))` with a single API call.
3. Add frontend or backend tests for the new day-loading behavior.

Acceptance criteria:

1. Opening a calendar day uses one backend request for note data.
2. The UI still shows the needed title/content/tags/date data.
3. The public API contract is documented.

### 6. Add Minimal CI

The repository has local commands and tests, but no visible CI workflow. Add a small pipeline before larger refactors.

Tasks:

1. Add a GitHub Actions workflow.
2. Backend job:
   - install dependencies;
   - run `ruff`;
   - run `pytest`;
   - verify OpenAPI snapshot drift.
3. Frontend job:
   - run `npm ci`;
   - run ESLint;
   - run Vitest;
   - run production build.
4. Document a basic rollback and migration policy.

Acceptance criteria:

1. Pull requests get automated backend and frontend checks.
2. OpenAPI drift is caught automatically.
3. Build failures are visible before merge.

### 7. Clean Up Smaller Reliability Issues

These are useful follow-up tasks if the main work finishes early.

Tasks:

1. Remove `time.sleep` from `backend/tests/test_pin.py` by using deterministic timestamps or deterministic ordering.
2. Replace shortcut routing based on `setTimeout(..., 30)` with declarative pending action state.
3. Move small inline frontend styles into CSS classes.
4. Split `i18n.jsx` into provider/resolver code and locale dictionaries if translation scope grows.

Acceptance criteria:

1. Pin tests no longer depend on timing sleeps.
2. Global shortcuts do not depend on mount timing.
3. Styling remains centralized.

## Recommended Order

1. Documentation alignment.
2. User timezone API and Settings UI.
3. Reminder timezone behavior per user.
4. Duplicate reminder protection.
5. Small service layer around account/reminder workflows.
6. Calendar N+1 fix.
7. Minimal CI.
8. Smaller reliability cleanups.

## Explicit Non-Goals For The Next Pass

Do not introduce Kafka, RabbitMQ, Redis queues, or a full event platform yet. The current app is better served by strengthening the existing Postgres-backed worker path first. A full DB outbox remains the right longer-term direction, but it should follow timezone, duplicate-send protection, and service extraction.

Do not normalize tags immediately unless expected data volume requires it. First document the current limitation and gather query-plan evidence before adding schema complexity.

Do not rewrite all routers into services at once. Move only the workflows that are already becoming complex.
