# Architecture

A small, single-user-per-account notes app. Three services, one repo.

## System overview

```mermaid
graph LR
    user([User])
    ui["Frontend<br/>React + Vite<br/>:5173"]
    api["Backend<br/>FastAPI + SQLAlchemy<br/>:8000"]
    db[("PostgreSQL 16<br/>:5432")]

    user -- HTTP --> ui
    ui -- "/api/*<br/>(Vite proxy)" --> api
    api -- SQL --> db
```

| Service    | Stack                                              | Port | Role                                        |
| ---------- | -------------------------------------------------- | ---- | ------------------------------------------- |
| `db`       | Postgres 16                                        | 5432 | Durable storage                             |
| `backend`  | Python 3.11, FastAPI, SQLAlchemy 2.0, Alembic, JWT | 8000 | REST API, auth, data access                 |
| `frontend` | React 18, Vite, React Router                       | 5173 | SPA; dev server proxies `/api` to `backend` |
| `worker`   | Python 3.11, APScheduler (same image as `backend`) | -    | Background reminders + Telegram `getUpdates` poll |

All four are orchestrated by `docker-compose.yml`. The frontend talks to the backend through the Vite dev proxy — there is no direct browser → backend call in dev.

## Components & responsibilities

### Services

- **`db`** — owns all persistent state. No logic lives here beyond schema (managed by Alembic) and ownership indexes. External deps: none. Data volume: `db_data`.
- **`backend`** — the only component allowed to talk to `db`. Owns authentication (JWT issuing and verification), authorization (per-row `user_id` filtering), domain logic (notes, tags, calendar aggregation, archive/pin semantics, pagination), and request validation (Pydantic). Exposes HTTP only — no background jobs.
- **`frontend`** — a pure SPA. Holds no server state; the JWT in `localStorage` is its only persistent local state. Talks only to `/api/*` via the Vite dev proxy. Owns layout, user interaction, optimistic UX affordances (markdown preview, keyboard shortcuts, calendar rendering).

### Backend packages

```mermaid
graph TD
    R["routers/*"] --> D[deps]
    R --> S[schemas]
    R --> M[models]
    R --> AU[auth]
    D --> M
    D --> C[config]
    M --> DB[db]
    AU --> C
```

- **`app/main.py`** — process entry point. Mounts CORS, routers, `/healthz`. No business logic.
- **`app/config.py`** — single source of truth for runtime configuration (`DATABASE_URL`, `JWT_SECRET`, etc.). Everything else imports `settings` from here.
- **`app/db.py`** — owns the SQLAlchemy engine, session factory, and `Base` (DeclarativeBase). Nothing else instantiates engines.
- **`app/models.py`** — ORM entities (`User`, `Note`). The only place that declares table shape.
- **`app/schemas.py`** — Pydantic DTOs for request bodies and responses. Decoupled from ORM so wire format can evolve independently (e.g., hiding fields from public responses).
- **`app/auth.py`** — password hashing (bcrypt) and JWT encoding. Pure functions; no I/O.
- **`app/deps.py`** — FastAPI dependencies: `get_db` (per-request session lifecycle) and `get_current_user` (JWT → `User`). Every protected route goes through `get_current_user`.
- **`app/routers/*`** — HTTP surface. Each router owns one area (`auth`, `account`, `notes`, `tags`) and is the **only** place allowed to call the ORM directly. Routers never import each other.
- **`alembic/versions/*`** — schema migrations, applied at container start. Must be reversible (both `upgrade` and `downgrade`).
- **`scripts/seed.py`** — idempotent demo data (wipes the demo user, recreates).
- **`scripts/dump_openapi.py`** — emits `app.openapi()` JSON; drives `make openapi-dump` and the drift test.

### Frontend packages

```mermaid
graph TD
    MAIN[main.jsx] --> APP[App.jsx]
    APP --> PAGES["pages/*"]
    APP --> HOOKS[hooks/useShortcuts]
    APP --> HELP[HelpOverlay]
    PAGES --> COMP["components/*"]
    PAGES --> API[api.js]
    COMP --> API
    COMP --> I18N[i18n.jsx]
    PAGES --> I18N
    API --> AUTH[auth.js]
    MAIN --> I18N
    MAIN --> THEME[theme.js]
```

- **`main.jsx`** — app bootstrap: calls `initTheme()`, wraps the tree in `LangProvider` and `BrowserRouter`.
- **`App.jsx`** — route map, top-level header, global shortcut wiring, registers actions forwarded from `Notes.jsx` (new/search/save) so shortcuts can reach them.
- **`api.js`** — the single network seam. Centralizes `Authorization` header, 401-triggered token clear, and JSON envelope. No page talks to `fetch` directly.
- **`auth.js`** — JWT in `localStorage`. Tiny, deliberate boundary.
- **`theme.js`** — `light` / `dark` / `system` via a `data-theme` attribute on `<html>`. Listens to `prefers-color-scheme` when the preference is `system`.
- **`i18n.jsx`** — React Context provider, `t(key, vars)` hook, EN fallback when RU is missing. The only translation mechanism.
- **`hooks/useShortcuts.js`** — global `keydown` listener; ignores editable targets except for `Cmd/Ctrl+S`.
- **`components/*`** — presentational + small behavior: `NoteEditor` (draft state + markdown toolbar), `NoteList` (virtualized-ready row), `TagFilter`, `ThemeToggle`, `LanguageToggle`, `MarkdownToolbar`, `HelpOverlay`.
- **`pages/*`** — screens with data-fetching and orchestration: `Login`, `Register`, `Notes` (list + editor + bulk + pagination + pin/archive), `Calendar`, `Settings`.

### Dependency rules worth keeping

- `routers/*` may depend on `deps`, `schemas`, `models`, `auth`; they must **not** depend on each other.
- `models` depends only on `db`. Business logic does not live here.
- Frontend `components/*` stay presentational; fetching lives in `pages/*`.
- `api.js` is the only module that calls `fetch`.
- Any new environment variable flows through `app/config.py` on the backend and through `import.meta.env` (`VITE_...`) on the frontend — never read directly from `process.env` or `localStorage` in business code.

## Data model

```mermaid
erDiagram
    USERS ||--o{ NOTES : owns
    USERS {
        int id PK
        string username
        string password_hash
        datetime created_at
    }
    NOTES {
        int id PK
        int user_id FK
        string title
        text content
        json tags
        date note_date
        datetime archived_at
        datetime pinned_at
        datetime created_at
        datetime updated_at
    }
```

- **Tags** are a JSON array on the note itself. The `/tags` endpoint derives the per-user list by scanning the user's notes. There is no separate `tags` table by design.
- **Ownership** is enforced in every query via `user_id = current_user.id`. There is no sharing model and no RBAC.
- **Soft-delete** uses `archived_at` (nullable timestamp). Default list view excludes archived.
- **Pinning** uses `pinned_at` (nullable timestamp). Non-null → sorted on top.

## Backend layout

```
backend/
├── app/
│   ├── main.py         FastAPI app, CORS, router mounts, /healthz
│   ├── config.py       pydantic-settings, env-driven (.env)
│   ├── db.py           engine + SessionLocal + DeclarativeBase
│   ├── models.py       ORM (SQLAlchemy 2.0 Mapped[] typing)
│   ├── schemas.py      Pydantic in/out schemas
│   ├── auth.py         bcrypt hashing, JWT encode
│   ├── deps.py         get_db, get_current_user (JWT → User)
│   └── routers/
│       ├── auth.py     /auth/register, /auth/login
│       ├── account.py  /account/change-password, DELETE /account
│       ├── notes.py    /notes CRUD, calendar, archive, pin, bulk-delete
│       └── tags.py     /tags
├── alembic/versions/   0001 init · 0002 archive+pin
├── scripts/
│   ├── seed.py         demo user + sample notes (make seed)
│   └── dump_openapi.py regenerates openapi.json (make openapi-dump)
├── tests/              pytest + cov (threshold 80%)
└── openapi.json        snapshot — drift test asserts equality with app.openapi()
```

## Frontend layout

```
frontend/src/
├── main.jsx            bootstraps LangProvider + Router + App
├── App.jsx             route map, header, global shortcuts wiring
├── api.js              fetch wrapper + API client
├── auth.js             JWT stored in localStorage
├── theme.js            light / dark / system via data-theme attribute
├── i18n.jsx            React Context, EN + RU, dotted keys with {name} interpolation
├── hooks/
│   └── useShortcuts.js global key bindings: n · / · Cmd+S · ? · Esc
├── components/         NoteEditor · NoteList · TagFilter ·
│                       ThemeToggle · LanguageToggle ·
│                       MarkdownToolbar · HelpOverlay
└── pages/              Login · Register · Notes · Calendar · Settings
```

Testing uses **vitest + jsdom + @testing-library/react**. Backend tests run independently with pytest against an in-memory SQLite per test.

## API surface

All paths are prefixed with `/api`. JWT is required everywhere except register/login and `/healthz`.

| Method              | Path                     | Notes                                                   |
| ------------------- | ------------------------ | ------------------------------------------------------- |
| POST                | `/auth/register`         | Public                                                  |
| POST                | `/auth/login`            | Public; returns JWT                                     |
| POST                | `/account/change-password` | Verifies current password                             |
| DELETE              | `/account`               | Cascade-deletes all notes of the user                   |
| GET                 | `/notes`                 | Paginated (`limit`/`offset`), `?archived`, `?q`, `?tag` — pinned first |
| POST                | `/notes`                 | Create                                                  |
| GET / PUT / DELETE  | `/notes/{id}`            | Get / update / hard-delete                              |
| POST                | `/notes/{id}/archive`    | Idempotent                                              |
| POST                | `/notes/{id}/unarchive`  | Idempotent                                              |
| POST                | `/notes/{id}/pin`        | Idempotent                                              |
| POST                | `/notes/{id}/unpin`      | Idempotent                                              |
| POST                | `/notes/bulk-delete`     | Body: `{"ids": [int]}`                                  |
| GET                 | `/notes/calendar`        | `year`, `month`; excludes archived                      |
| GET                 | `/tags`                  | Distinct tag list for the user                          |
| GET                 | `/account/telegram`      | Telegram link + reminder status                         |
| POST                | `/account/telegram/link` | Issue a one-time deep-link code (503 if bot unconfigured) |
| DELETE              | `/account/telegram`      | Unlink chat + disable reminders                         |
| PUT                 | `/account/telegram/reminders` | `{enabled}`; 409 if no chat linked                 |
| PUT                 | `/account/telegram/timezone`  | `{timezone}`; IANA-validated                       |
| GET                 | `/export/note/{id}`      | Markdown attachment (timestamped filename)              |
| GET                 | `/export/notes`          | Zip of all the user's notes as `.md`                    |
| POST / DELETE       | `/notes/{id}/share`      | Create / revoke a public read-only token                |
| GET                 | `/share/{token}`         | **Public, no auth** — read-only note projection         |
| GET                 | `/healthz`               | Liveness                                                |

The full machine-readable schema lives at `backend/openapi.json`. Regenerate with `make openapi-dump`; a drift test in the backend suite fails if the committed snapshot is stale.

## Cross-cutting concerns

- **AuthN** — JWT HS256, `JWT_SECRET` from env; token sent as `Authorization: Bearer <token>`.
- **AuthZ** — ownership check in every route; no roles, no sharing.
- **Migrations** — Alembic; `alembic upgrade head` runs at backend container startup.
- **i18n** — two languages (`en`, `ru`); EN is the fallback when a key is missing.
- **Theming** — `data-theme="light|dark"` on `<html>`; `system` resolves from `prefers-color-scheme`.
- **Testing boundary** — backend uses SQLite in tests; any Postgres-specific SQL must stay behind SQLAlchemy or be called out.

## Telegram reminders, export & sharing

A note's `note_date` now does something when it arrives: the owner gets a Telegram message.

- **Background work lives in a separate `worker` service**, not in `backend`. The API process is a single `uvicorn --reload`; a scheduler in-process would fight the reloader and there can be only one `getUpdates` consumer. The worker shares the backend image and runs `scripts/worker.py`: an APScheduler interval job (`process_due`) plus a `getUpdates` long-poll for account linking. With no `TELEGRAM_BOT_TOKEN` it validates nothing and idles, so `make up` still works.
- **Linking** is a deep link: `POST /account/telegram/link` issues a short-lived one-time code, the UI shows `t.me/<bot>?start=<code>`, the user presses Start, and the worker binds that chat to the account. Code is single-use and expires in 15 min.
- **"Date arrived" = start of that day in the user's timezone.** `note_date` is a bare `DATE`; each user has a `timezone` and the due check is `note_date <= today-in-that-zone` (`zoneinfo`).
- **Idempotency is claim-first.** Delivery is gated by a `reminders_sent` row with `UNIQUE(note_id, note_date)`: the worker inserts+commits the claim *before* sending, so a concurrent tick or a second worker that loses the insert race never sends. A send that fails every retry deletes its claim and is retried next tick. Net guarantee: never twice (at-most-once on the failure path).
- **Retries**: bounded exponential backoff inside `_deliver`; the Telegram client (`app/telegram.py`) is a thin httpx wrapper kept out of `reminders.py` so the core is unit-testable with a fake sender.
- **Export** (`routers/export.py`): a note as `.md` or all notes as a `.zip`, timestamped filenames, owner-scoped.
- **Public sharing** (`routers/share.py`): `POST /notes/{id}/share` mints a `public_token`; `GET /share/{token}` is the one unauthenticated route, returning a deliberately narrow `SharedNoteOut` (no ids, no owner). Revoke clears the token.

New env vars (all optional, in `.env.example`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `REMINDER_INTERVAL_SECONDS`.
