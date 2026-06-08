# Plan: Async Delivery, User Timezone, DB Outbox, Worker, Idempotency

## Goal

Add a safe asynchronous execution path for future message delivery and reminders:

- user timezone support;
- durable DB outbox;
- separate worker process;
- retry policy with backoff;
- idempotency at API and delivery levels;
- protection against duplicate message sends.

This plan is designed for the current repo shape: `FastAPI + SQLAlchemy + Postgres + React/Vite`, with no broker yet and no existing background job subsystem.

## Target Architecture

The target flow is:

1. Client sends a command with `Idempotency-Key`.
2. API validates the request.
3. API writes business state and an `outbox_message` row in one DB transaction.
4. API returns immediately.
5. Worker polls the outbox table for due messages.
6. Worker sends the message through an external provider adapter.
7. Worker marks the row as `sent`, `retry`, or `dead`.

Key rules:

- HTTP handlers do not call the external provider directly.
- System timestamps are stored in UTC.
- User local time is interpreted through a stored IANA timezone.
- One logical send operation must not result in two provider sends.

## Scope of Changes

Backend areas to change:

- `backend/app/models.py`
- `backend/app/schemas.py`
- `backend/app/config.py`
- `backend/app/routers/account.py`
- `backend/app/routers/notes.py`
- `backend/app/main.py`
- new `backend/app/services/`
- new `backend/app/integrations/` or `backend/app/providers/`
- new `backend/app/worker.py`
- new Alembic migrations
- new backend tests

Frontend areas to change:

- `frontend/src/api.js`
- `frontend/src/pages/Settings.jsx`
- form flows that create send-worthy commands
- optional date/time formatting helpers if message scheduling reaches UI

Docs to update:

- `docs/architecture.md`
- this implementation plan file

## Constraints and Design Decisions

### 1. Start with Postgres outbox, not a broker

Reasoning:

- the repo already depends on Postgres;
- there is no queue infrastructure today;
- DB outbox is the smallest correct next step;
- it preserves transactional consistency between domain writes and async intents.

Decision:

- first implementation uses `Postgres outbox + polling worker`;
- no Redis/RabbitMQ/Kafka in phase 1.

### 2. Introduce a service layer

The current architecture says routers are the only place allowed to call ORM directly. That works for synchronous CRUD, but it does not scale to:

- shared transactional workflows;
- idempotency handling;
- outbox writes;
- worker reuse of domain logic.

Decision:

- add `app/services/`;
- routers become thin transport adapters;
- worker also uses services.

### 3. Keep timezone semantics explicit

Decision:

- store user timezone as IANA string, for example `Europe/Moscow`;
- store scheduled instants in UTC;
- when user enters local wall-clock time, resolve it with `user.timezone` before persistence;
- do not derive business-local dates from server-local time.

## Phase 0: Architecture and Documentation

### Tasks

1. Update `docs/architecture.md` to reflect the new shape:
   - backend now owns HTTP and async orchestration;
   - add a `worker` service to the system overview;
   - note that external delivery is asynchronous via DB outbox.
2. Document dependency rules:
   - `routers/* -> services/* -> models/db/integrations`
   - `worker -> services`
   - routers must not talk to providers directly.
3. Write down the delivery guarantees:
   - API idempotency for command submission;
   - at-least-once execution with dedupe for provider delivery.

### Deliverable

- agreed target architecture documented before implementation begins.

## Phase 1: User Timezone Support

### Data model

Add `timezone` to `users`.

Suggested shape:

- `timezone: String(64)`
- non-null
- default `UTC`

### Backend tasks

1. Extend `User` in `backend/app/models.py`.
2. Add Alembic migration.
3. Add schema support for account preferences:
   - `AccountOut`
   - `UpdateAccountPreferencesIn`
4. Validate timezone via `zoneinfo.ZoneInfo`.
5. Add account endpoints:
   - `GET /api/account`
   - `PATCH /api/account/preferences` or `PATCH /api/account`

### Frontend tasks

1. Add timezone field to `frontend/src/pages/Settings.jsx`.
2. Pre-fill from browser when helpful:
   - `Intl.DateTimeFormat().resolvedOptions().timeZone`
3. Persist via backend API.

### Acceptance criteria

- user can read and update timezone;
- backend rejects invalid timezone strings;
- default users get `UTC`.

## Phase 2: Time Semantics Cleanup

### Rules to establish

1. `created_at`, `updated_at`, `archived_at`, `pinned_at`, `sent_at` are UTC timestamps.
2. `scheduled_at_utc` is the canonical execution instant.
3. Local business time must always be resolved through `user.timezone`.
4. `date.today()` must not define business behavior for scheduled delivery.

### Tasks

1. Audit current uses of time creation helpers.
2. Centralize helpers such as:
   - `utc_now()`
   - `resolve_local_datetime_to_utc(local_dt, timezone)`
3. Avoid server-local time in future scheduling logic.
4. Keep `note_date` semantics unchanged unless scheduling is attached to notes later.

### Acceptance criteria

- all delivery scheduling logic is based on UTC + explicit timezone conversion;
- no message timing depends on machine-local timezone.

## Phase 3: DB Outbox Schema

### New table: `outbox_messages`

Suggested columns:

- `id`
- `event_type`
- `aggregate_type`
- `aggregate_id`
- `channel`
- `payload` (`JSON` / `JSONB`)
- `dedupe_key`
- `status`
- `scheduled_at_utc`
- `attempt_count`
- `next_attempt_at_utc`
- `locked_by`
- `locked_until_utc`
- `provider_message_id`
- `last_error`
- `created_at`
- `updated_at`
- `sent_at`

Suggested statuses:

- `pending`
- `processing`
- `sent`
- `retry`
- `dead`

### Indexes and constraints

Required:

- unique index on `dedupe_key`
- index on `(status, next_attempt_at_utc)`
- index on `locked_until_utc`

Optional later:

- index on `(aggregate_type, aggregate_id)` for traceability

### Tasks

1. Add ORM model.
2. Add migration.
3. Add response/debug schemas if needed for ops endpoints.

### Acceptance criteria

- one logical delivery intent has one durable row;
- a duplicate `dedupe_key` cannot create a second outbox record.

## Phase 4: API Idempotency Schema

### New table: `idempotency_keys`

Suggested columns:

- `id`
- `scope`
- `idempotency_key`
- `request_hash`
- `status`
- `response_status_code`
- `response_body`
- `resource_type`
- `resource_id`
- `created_at`
- `expires_at`

Constraint:

- unique `(scope, idempotency_key)`

### Semantics

1. First request stores the key and request hash.
2. Repeat with same key and same request payload returns stored result.
3. Repeat with same key and different payload returns `409 Conflict`.

### Scope design

Recommended scope format:

- `user:{user_id}:route:{route_name}`

That prevents accidental reuse across unrelated commands.

### Tasks

1. Add ORM model and migration.
2. Add helper for request canonicalization and hashing.
3. Add service wrapper for idempotent command execution.
4. Roll out first to message-producing endpoints.
5. Optionally extend to `POST /notes` to prevent duplicate note creation on double submit.

### Acceptance criteria

- repeated command submission is safe;
- same key + different body is rejected deterministically.

## Phase 5: Service Layer Introduction

### New package

Create `backend/app/services/`.

Suggested modules:

- `account_service.py`
- `notes_service.py`
- `outbox_service.py`
- `idempotency_service.py`
- `delivery_service.py`

### Responsibilities

Routers:

- validate HTTP input;
- resolve auth/user/db;
- call service;
- map result to HTTP response.

Services:

- own transaction boundaries;
- register idempotency keys;
- write business state;
- write outbox rows;
- expose reusable workflows to worker and tests.

### Tasks

1. Move non-trivial write workflows out of routers.
2. Introduce one transaction per command.
3. Ensure outbox write occurs in the same transaction as business state write.

### Acceptance criteria

- routers are transport-only;
- worker does not need to import routers;
- domain command execution is testable without HTTP.

## Phase 6: Provider Integration Adapter

### New package

Create `backend/app/integrations/` or `backend/app/providers/`.

### Provider interface

Suggested contract:

- `send(payload, dedupe_key, timeout_seconds) -> ProviderSendResult`

Where result includes:

- provider status
- provider message ID if available
- retryability classification

### Config additions

Add to `backend/app/config.py`:

- `provider_base_url`
- `provider_api_token`
- `provider_timeout_seconds`
- `worker_batch_size`
- `worker_poll_interval_seconds`
- `worker_max_attempts`
- `worker_retry_base_seconds`
- `worker_retry_max_seconds`

### Error classes

Introduce clear categories:

- retryable
- non-retryable
- unknown

### Acceptance criteria

- provider logic is isolated behind a narrow interface;
- routes and worker do not know provider-specific HTTP details.

## Phase 7: Worker Process

### New runtime unit

Add `backend/app/worker.py` and a new `worker` service in `docker-compose.yml`.

### Worker loop responsibilities

1. Poll due rows from `outbox_messages`.
2. Claim a batch safely.
3. Call provider adapter.
4. Update row state.
5. Sleep for configured interval.

### Concurrency control

Use Postgres-safe claim semantics.

Recommended approach:

- `SELECT ... FOR UPDATE SKIP LOCKED`
- lease fields: `locked_by`, `locked_until_utc`

Reason:

- prevents two workers from processing the same row at once;
- lets expired work be picked up after crash or hang.

### Tasks

1. Implement claim batch query.
2. Implement lease expiration recovery.
3. Implement graceful shutdown behavior.
4. Add structured logs for message lifecycle.

### Acceptance criteria

- multiple workers do not process the same row concurrently;
- crashed worker does not stall rows forever.

## Phase 8: Retry Policy and Backoff

### Retry rules

Retry:

- network errors
- timeouts
- `429`
- `5xx`

Do not retry:

- validation failures
- malformed payload rejection
- permanent provider business rejection
- other known non-retryable `4xx`

### Backoff policy

Use exponential backoff with jitter.

Suggested formula:

- `delay = min(base * 2^attempt, max) + random_jitter`

### Tasks

1. Add retry policy helper.
2. Increment `attempt_count` on each failed try.
3. Set `next_attempt_at_utc` on retryable errors.
4. Move row to `dead` after `max_attempts`.
5. Persist compact structured `last_error`.

### Acceptance criteria

- transient failures retry automatically;
- permanent failures stop retrying;
- dead-letter state exists for operator visibility.

## Phase 9: Duplicate-Send Protection

### Delivery-level idempotency

The main rule is:

- one logical send operation must map to one stable `dedupe_key` across all attempts.

### Required behavior

1. Same command replay must not create a second outbox row.
2. Same outbox row retry must not create a second provider delivery.
3. If provider supports idempotency keys, pass `dedupe_key` through.
4. If provider does not support idempotency keys, keep local dedupe authoritative.

### Ambiguous provider outcomes

If a timeout happens after the provider may have accepted the request:

- do not blindly re-send with a new key;
- retry with the same `dedupe_key` only;
- if the provider has a reconciliation endpoint, use it before re-sending;
- if the final state cannot be proven, prefer `manual_review` or `dead` over unsafe duplication.

### Acceptance criteria

- repeated attempts do not become repeated sends.

## Phase 10: Frontend Updates

### API client

Extend `frontend/src/api.js` to support optional `Idempotency-Key` header.

### UX protections

For send-worthy forms:

1. add `inFlight` guard;
2. disable duplicate submit while request is active;
3. keep client retries disabled for unsafe POST commands;
4. optionally allow bounded retry for GET requests later.

### Settings page

1. add timezone preference UI;
2. load current timezone from backend;
3. save timezone back through account API.

### Acceptance criteria

- UI does not generate duplicate command submissions via double click;
- timezone preference is manageable from the app.

## Phase 11: Testing Strategy

### Unit tests

Add tests for:

- timezone validation
- local-to-UTC conversion
- retry classification
- backoff computation
- idempotency request hashing

### API tests

Add tests for:

- same `Idempotency-Key` + same body returns same result
- same `Idempotency-Key` + different body returns `409`
- account timezone read/update

### Worker tests

Add tests for:

- `pending -> sent`
- retryable error -> `retry`
- non-retryable error -> `dead`
- lease expiration recovery

### Concurrency tests

Add tests proving:

- two workers cannot successfully claim the same row.

### Postgres-specific coverage

Important note:

- current backend tests run on SQLite;
- `SKIP LOCKED` and row-lock semantics are Postgres-specific;
- concurrency claim logic should have dedicated Postgres integration tests.

Do not weaken the production design to fit SQLite-only behavior.

### Acceptance criteria

- idempotency, worker flow, retries, and timezone logic are covered by automated tests;
- Postgres-only concurrency behavior is tested in a matching environment.

## Phase 12: Rollout Plan

### Deployment order

1. deploy migrations;
2. deploy backend that understands new schema;
3. deploy worker process;
4. enable delivery behind flags;
5. monitor and widen usage.

### Recommended feature flags

- `OUTBOX_ENABLED`
- `WORKER_ENABLED`
- `DELIVERY_ENABLED`

### Safe rollout strategy

1. Start by writing outbox rows without real provider sends.
2. Validate row creation, worker claiming, and status transitions.
3. Enable provider sends for test users or test channel.
4. Enable globally after metrics and logs are stable.

### Operational needs

Add:

- cleanup job for expired idempotency keys;
- visibility into `dead` rows;
- documented manual replay procedure.

### Acceptance criteria

- the feature can be introduced incrementally without a big-bang cutover.

## Suggested PR Breakdown

### PR 1

- `user.timezone`
- account read/update API
- settings UI
- timezone validation tests

### PR 2

- service layer skeleton
- `outbox_messages` schema
- `idempotency_keys` schema
- basic transactional command flow

### PR 3

- provider adapter
- worker runtime
- retry policy
- status transitions

### PR 4

- frontend idempotency header support
- submit guards
- observability
- cleanup jobs
- docs updates

## Definition of Done

The work is complete when all of the following are true:

1. Each user has a validated stored timezone.
2. Delivery-related command endpoints support `Idempotency-Key`.
3. Repeated command submission does not create duplicate business effects.
4. Business write and outbox write happen in one transaction.
5. API returns before external delivery happens.
6. Worker processes due outbox rows asynchronously.
7. Retryable failures back off and retry automatically.
8. Non-retryable failures stop and become visible.
9. One logical message intent does not produce double delivery.
10. The architecture and rollout are documented in `docs/architecture.md`.

## Recommended Implementation Order

Use this sequence to minimize risk and rework:

1. user timezone
2. service layer introduction
3. outbox schema
4. idempotency schema and command wrapper
5. worker runtime
6. provider adapter
7. retries and observability
8. frontend idempotency header and submit guard

This order keeps the repo working at every intermediate step while moving toward safe asynchronous delivery.
