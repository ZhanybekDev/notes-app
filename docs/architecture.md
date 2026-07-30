# Architecture

A small, single-user-per-account notes app. Three services, one repo.

## System overview

```mermaid
graph LR
    user([User])
    ui["Frontend<br/>React + Vite<br/>:5173"]
    api["Backend<br/>FastAPI + SQLAlchemy<br/>:8000"]
    wk["Worker<br/>long polling + outbox"]
    db[("PostgreSQL 16<br/>:5432")]
    tg{{"Telegram<br/>Bot API"}}

    user -- HTTP --> ui
    ui -- "/api/*<br/>(Vite proxy)" --> api
    api -- SQL --> db
    wk -- SQL --> db
    wk -- "getUpdates / sendMessage" --> tg
    tg -. "reminder" .-> user
```

| Service    | Stack                                              | Port | Role                                        |
| ---------- | -------------------------------------------------- | ---- | ------------------------------------------- |
| `db`       | Postgres 16                                        | 5432 | Durable storage                             |
| `backend`  | Python 3.11, FastAPI, SQLAlchemy 2.0, Alembic, JWT | 8000 | REST API, auth, data access                 |
| `worker`   | Python 3.11, same image as `backend`               | —    | Telegram long polling, reminder delivery    |
| `frontend` | React 18, Vite, React Router, Zustand              | 5173 | SPA; dev server proxies `/api` to `backend` |

All four are orchestrated by `docker-compose.yml`. The frontend talks to the backend through the Vite dev proxy — there is no direct browser → backend call in dev.

`worker` runs exactly one replica. The Bot API answers a second concurrent `getUpdates` on the same token with `409 Conflict`, so polling cannot be scaled horizontally; delivery could be, because due rows are claimed with `FOR UPDATE SKIP LOCKED`.

## Components & responsibilities

### Services

- **`db`** — owns all persistent state. No logic lives here beyond schema (managed by Alembic) and ownership indexes. External deps: none. Data volume: `db_data`.
- **`backend`** — owns authentication (JWT issuing and verification), authorization (per-row `user_id` filtering), domain logic (notes, tags, calendar aggregation, archive/pin semantics, pagination), and request validation (Pydantic). Exposes HTTP only — anything that has to run without an incoming request lives in `worker`.
- **`worker`** — the only component that runs on its own clock. Long-polls the Bot API for `/start` deep links, and on a 30-second cadence reconciles the reminder outbox and delivers what is due. Shares the `backend` image and the `app/` package; the process itself holds no domain logic. Kept out of the API process because `backend` runs under uvicorn `--reload`, which would restart a background loop on every file change.
- **`frontend`** — a pure SPA. Holds no server state. What it keeps between visits lives in four `localStorage` keys — the JWT, the language, the theme and one dismissed hint — all written through `stores/safeStorage.js`. Talks only to `/api/*` via the Vite dev proxy. Owns layout, user interaction, optimistic UX affordances (markdown preview, keyboard shortcuts, calendar rendering).

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
- **`app/telegram.py`** — thin Bot API client (`getUpdates`, `sendMessage`) over `httpx`. Raises `TelegramRetryAfter` for 429 so callers can honour `retry_after` literally. Never sets `parse_mode`: notes are Markdown, and unbalanced markup would make the API reject real notes with 400. The token lives in the request URL, so no error path echoes the URL.
- **`app/bot_i18n.py`** — message catalogue for everything the bot says, plus the mapping from an
  IETF tag to a language we have. English is the fallback, matching `i18n.jsx`.
- **`app/bot_commands.py`** — the single entry point for an incoming update: parses the command,
  routes it and renders the reply. Everything the bot says lives here, so there is one place to
  look for what a user will read.
- **`app/telegram_link.py`** — issuing and redeeming `/start` deep-link codes (15-minute TTL, single use). Binding is what turns notifications on; unlinking turns them off. Returns a `LinkResult`; the wording that reaches the user belongs to `bot_commands`.
- **`app/reminders.py`** — reminder scheduling: local-time → UTC conversion, outbox materialisation, resync after settings changes, cancellation of rows whose preconditions lapsed, claiming and marking. Pure domain logic over a `Session`.
- **`app/deps.py`** — FastAPI dependencies: `get_db` (per-request session lifecycle) and `get_current_user` (JWT → `User`). Every protected route goes through `get_current_user`.
- **`app/routers/*`** — HTTP surface. Each router owns one area (`auth`, `account`, `notes`, `tags`) and is the **only** place allowed to call the ORM directly. Routers never import each other.
- **`alembic/versions/*`** — schema migrations, applied at container start. Must be reversible (both `upgrade` and `downgrade`).
- **`scripts/seed.py`** — idempotent demo data. Replaces the demo notes but leaves the account
  alone: it used to delete the user, which meant every re-seed silently dropped the Telegram
  binding and the reminder preferences. Only the password is forced back, so the credentials
  in the README stay true.
- **`scripts/dump_openapi.py`** — emits `app.openapi()` JSON; drives `make openapi-dump` and the drift test.

### Frontend packages

```mermaid
graph TD
    MAIN[main.jsx] --> APP[App.jsx]
    APP --> PAGES["pages/*"]
    APP --> HOOKS[hooks/useShortcuts]
    APP --> HELP[HelpOverlay]
    PAGES --> COMP["components/*"]
    PAGES --> STORES["stores/*"]
    STORES --> API[api.js]
    PAGES --> API
    COMP --> API
    COMP --> I18N[i18n.jsx]
    PAGES --> I18N
    STORES --> SAFE[safeStorage.js]
    MAIN --> THEME[theme.js]
    THEME --> STORES
```

- **`main.jsx`** — app bootstrap: calls `initTheme()` and `initLang()` before the first render, then mounts `BrowserRouter`. Both run early on purpose: a subscription alone fires only on change, which would paint the first frame light for a dark-theme user and leave `<html lang>` briefly wrong.
- **`App.jsx`** — route map, top-level header, global shortcut wiring, registers actions forwarded from `Notes.jsx` (new/search/save) so shortcuts can reach them.
- **`api.js`** — the single network seam. Centralizes the `Authorization` header (token read from `stores/sessionStore`), the 401 that ends a session, and the JSON envelope. No page talks to `fetch` directly.
- **`stores/safeStorage.js`** — the only module that touches `localStorage` directly, and the
  successor to the boundary `auth.js` used to hold. Read, write and remove never throw: a browser
  that refuses storage (private mode, enterprise policy) would otherwise take the app down at import
  time, because `persist` hydrates before the first render. The first failure logs once and flips a
  flag the session store exposes as `persistAvailable`, which Settings turns into a warning: the
  session will not survive a reload, and the user learns that before it happens rather than after.
- **`theme.js`** — turns the stored preference into a `data-theme` attribute on `<html>`: `applyTheme(theme)` plus the subscription and `prefers-color-scheme` listener that `initTheme()` installs. The preference itself lives in `stores/prefsStore`.
- **`messages.js` / `i18n.jsx`** — the catalogue and the pure `translate(lang, key, vars)` live in `messages.js` so the headless store layer can translate without importing a module that also exports React hooks. `i18n.jsx` holds `useLang()`, which reads the language from `stores/prefsStore` and returns the same `{ lang, setLang, t }` shape it always did, and re-exports both names. EN is the fallback when RU is missing. No Context: the app has none left. The language is always read through `selectLang`, never `state.lang` — that field is `null` until the reader picks one, and reading it raw resolves to English regardless of the browser.
- **`hooks/useShortcuts.js`** — global `keydown` listener; ignores editable targets except for `Cmd/Ctrl+S`.
- **`components/*`** — presentational + small behavior: `NoteEditor` (draft state + markdown toolbar), `NoteList` (virtualized-ready row), `TagFilter`, `ThemeToggle`, `LanguageToggle`, `MarkdownToolbar`, `HelpOverlay`.
- **`pages/*`** — screens with data-fetching and orchestration: `Login`, `Register`, `Notes` (list + editor + bulk + pagination + pin/archive), `Calendar`, `Settings`.
- **`styles/*`** — the design system, imported by `styles.css` in a significant order: `tokens`
  (every spacing, type, colour, radius and duration value in the app), `base` (reset, body
  typography, the `:focus-visible` system), `components`, `screens`, and `motion` last. A literal
  spacing or font-size value in a rule is a bug, not a shortcut. `motion.css` both comes last **and**
  uses `!important`: later position only wins at equal specificity, and a class like `.toast.error`
  outranks the universal selector, so ordering alone would leave `prefers-reduced-motion` silently
  not working. Nothing in the test suite can catch that — `vite.config.js` sets `css: false`, so
  vitest never processes a stylesheet.
- **`stores/*`** — Zustand stores holding state shared beyond one screen, plus the async actions that own it. A mutation reloads what it invalidated, so no caller has to remember. Stores are headless: no `window`, no DOM, so they are unit-tested without React. `index.js` exports `resetStores()`, which the test setup calls after every test because a store is a singleton for the whole test process. Local state that nobody shares — form drafts, the calendar's visible month — stays in `useState` on purpose.

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
    USERS ||--o{ REMINDERS : receives
    NOTES ||--o{ REMINDERS : triggers
    USERS {
        int id PK
        string username
        string password_hash
        string timezone
        time reminder_time
        bool notifications_enabled
        bigint telegram_chat_id
        string telegram_username
        string telegram_language
        datetime telegram_linked_at
        string telegram_link_code
        datetime telegram_link_code_expires_at
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
    REMINDERS {
        int id PK
        int user_id FK
        int note_id FK
        date note_date
        datetime scheduled_for
        string status
        int attempts
        text last_error
        datetime sent_at
        datetime created_at
    }
```

- **Reminders** are an outbox. `UNIQUE (note_id, note_date)` is what makes delivery exactly-once. The key is deliberately the calendar date and not `scheduled_for`: the latter is derived from the user's timezone and reminder time, so keying on it would let a settings change insert a second row while the first was still pending — two messages for one note.
- `status` moves `pending → sent | failed | cancelled`. A `cancelled` row still holds the key, so materialisation revives it if the note's date comes back; a `sent` row is never revived.

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
│   ├── telegram.py     Bot API client (getUpdates, sendMessage)
│   ├── bot_i18n.py     message catalogue for the bot (en / ru)
│   ├── bot_commands.py command routing and replies
│   ├── telegram_link.py deep-link codes, /start redemption
│   ├── reminders.py    scheduling, outbox reconciliation, delivery bookkeeping
│   └── routers/
│       ├── auth.py     /auth/register, /auth/login
│       ├── account.py  /account/change-password, settings, telegram link, DELETE /account
│       ├── notes.py    /notes CRUD, calendar, archive, pin, bulk-delete
│       └── tags.py     /tags
├── alembic/versions/   0001 init · 0002 archive+pin · 0003 telegram settings · 0004 reminders
│                       0005 (note_date, id) index · 0006 telegram language
├── scripts/
│   ├── seed.py         demo notes; keeps the account and its Telegram binding
│   ├── worker.py       long-polling loop + delivery tick (compose service `worker`)
│   └── dump_openapi.py regenerates openapi.json (make openapi-dump)
├── tests/              pytest + cov (threshold 80%)
└── openapi.json        snapshot — drift test asserts equality with app.openapi()
```

## Frontend layout

```
frontend/src/
├── main.jsx            applies theme + lang, then mounts Router + App
├── App.jsx             route map, header, global shortcuts wiring
├── api.js              fetch wrapper + API client
├── theme.js            light / dark / system via data-theme attribute
├── messages.js         EN + RU catalogue + translate(): pure, importable from stores
├── i18n.jsx            useLang(), initLang(); re-exports MESSAGES and translate
├── styles.css          entry point: five @imports, order significant
├── styles/             tokens · base · components · screens · motion
├── stores/             notesStore · accountStore · sessionStore · prefsStore · uiStore ·
│                       safeStorage · index.js (resetStores)
├── hooks/
│   ├── useShortcuts.js global key bindings: n · / · Cmd+S · ? · Esc
│   └── useDelayedFlag.js  raises a flag only if the wait outlasts 300ms
├── components/         NoteEditor · NoteList · TagFilter · LoadFailure · BusyButton ·
│                       ThemeToggle · LanguageToggle · Toaster · Skeleton ·
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
| GET                 | `/account/settings`      | Timezone, reminder time, notification and link status   |
| PATCH               | `/account/settings`      | Partial update; unknown IANA timezone → 422             |
| POST                | `/account/telegram/link` | Issues a deep link; 503 when the bot is not configured  |
| DELETE              | `/account/telegram`      | Unlinks and disables reminders; idempotent              |
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
| GET                 | `/healthz`               | Liveness                                                |

The full machine-readable schema lives at `backend/openapi.json`. Regenerate with `make openapi-dump`; a drift test in the backend suite fails if the committed snapshot is stale.

## Cross-cutting concerns

- **AuthN** — JWT HS256, `JWT_SECRET` from env; token sent as `Authorization: Bearer <token>`.
- **AuthZ** — ownership check in every route; no roles, no sharing.
- **Migrations** — Alembic; `alembic upgrade head` runs at backend container startup.
- **i18n** — two languages (`en`, `ru`); EN is the fallback when a key is missing. The bot has its
  own catalogue in `app/bot_i18n.py`: it has no session and cannot read the browser's language, so
  it follows `language_code` from the Telegram update and records it on the account, refreshed on
  every update rather than written once at link time, so that reminders sent days later read the
  same way as the last answer did even for someone who switched their client language since.
- **Theming** — `data-theme="light|dark"` on `<html>`; `system` resolves from `prefers-color-scheme`.
- **Frontend state** — five Zustand stores. `notesStore` holds the list, its filters, its request
  status and the selection; `accountStore` holds the reminder settings shared by `/notes` and
  `/settings`; `uiStore` holds the toast queue and nothing else — the timers live in `<Toaster />`,
  because a `setTimeout` owned by a store outlives both the page that caused it and `resetStores()`;
  `sessionStore` holds the JWT and makes the session reactive; `prefsStore` holds language, theme and
  one dismissed hint, persisted to the three legacy keys through a fan-out adapter because `persist`
  otherwise owns exactly one storage entry per store. A language the user never picked is not
  written at all — `lang: null` means "follow the browser", read through `selectLang`. Async actions reload what they invalidated, so
  no caller has to remember. Domain stores report a failure by calling `reportFailure` from `uiStore`
  — one direction only, `uiStore` imports nothing — while keeping their own `error` field as the source
  of truth: the toast is how a failure is shown, not where it is kept. `reportFailure` swallows a 401,
  because `api.js` answers that by ending the session and the redirect to the login form is already the
  feedback; a toast would put an untranslated "Unauthorized" alert on that form. What the toast says
  follows one rule: a message the server sent is passed through, because its answer is more specific
  than anything the client could invent, while a rejection carrying no status never reached the server
  — the network — and gets our own translated wording instead of the browser's "Failed to fetch". The
  gap that remains: server `detail` strings are English, and a toast is announced assertively, so a
  Russian interface can still read one English sentence. A background failure therefore
  appears twice on purpose, as an event (the toast, which leaves) and as a state (`components/LoadFailure`
  in the list, the calendar grid or one opened day, which stays, with a retry). Empty states are
  Every request has both halves: a failure path that reports and records, and a visible sign that it
  is running. Area loads show a skeleton after 300ms — the notes list, the settings card, the month
  grid, the notes of one opened day — and nothing before that, so a fast answer never flashes. Actions
  show it on the button that started them: the domain stores carry a `busy` tag naming the request in
  flight (`'save'`, `'remove'`, `'pin'`, `'archive'`, `'bulk'`, `'more'`, `'patch'`, `'unlink'`), the
  page turns that into `busy` on one `BusyButton`, and the same tag refuses a second call while the
  first is out — the disabled button and the store guard are two halves of one rule, since a button
  cannot be trusted alone. Empty states are
  claims about the server's answer, so they render only once an answer exists: while the first request
  is in flight the area stays blank rather than announcing an empty account. "No answer yet" is tracked
  by `notesStore.loaded`, not by the length of the list — an empty result is an answer too, and keying
  it on the list made "Nothing found" blink on every keystroke. Form errors stay next to their field: a
  toast about a wrong password would expire while it was being read. What stays in `useState`: form
  drafts, the calendar's visible month, the timer that dismisses the "saved" notice — state nobody
  else needs, plus one timer that must not outlive its screen.
- **Testing boundary** — backend uses SQLite in tests; any Postgres-specific SQL must stay behind SQLAlchemy or be called out. `claim_batch` uses `FOR UPDATE SKIP LOCKED`, which SQLite silently ignores — the locking behaviour is therefore asserted against the compiled Postgres SQL rather than by running two sessions.
- **Bot commands** — `/today`, `/upcoming`, `/status`, `/pause`, `/resume`, `/help`, published with
  `setMyCommands` once per supported language and once for the language-less scope, which is what
  clients outside `en`/`ru` resolve against. Publishing is advisory but not one-shot: a worker that
  could not reach Telegram at startup retries every five minutes until the menu takes. Everything
  but `/start` and `/help` needs a linked chat; an unlinked one is invited to link rather than told
  anything about an account.
- **Reminders** — a note's date fires at the owner's `reminder_time` in their `timezone`. Scheduling converts local → UTC once, at materialisation, and re-derives it whenever settings change. Rows are created up to 48 h ahead and never fire more than 24 h late, so a worker that was down does not flush a backlog. A cancelled row is revived only into the future, so the messages `/pause` suppressed are not delivered in a burst on `/resume`.
- **Configuration** — `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` reach the containers through `backend/.env`, which pydantic-settings reads directly (`env_file=".env"`, WORKDIR `/app`). They are deliberately *not* declared in compose `environment`: `${VAR:-}` interpolates to an empty string when no root `.env` exists and would silently override the file. Empty values are normalised to `None`, so a copied `.env.example` reads as "not configured" rather than "configured with a blank token".
