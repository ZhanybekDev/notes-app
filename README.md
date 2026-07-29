# Notes

A personal Markdown notes app. Keep notes, tag them, search them, and pin some to a date so you can browse them on a calendar.

Each user has their own private space. Every note is a Markdown document with a live preview while editing.

## What's inside

- Log in / register (single-user-per-account — no sharing).
- CRUD for notes with Markdown preview.
- Tags with filtering.
- Full-text search across title and body.
- Optional date on a note + a calendar view.
- Telegram reminders when a note's date arrives.

## Run it

Requirements: Docker with Compose.

```bash
make up          # start db + backend + frontend
make seed        # (optional) create a demo user with a few notes
```

Then open <http://localhost:5173>.

Demo credentials (after `make seed`):

- **username:** `demo`
- **password:** `demo1234`

## Telegram reminders

A note with a date can send you a Telegram message when that date arrives. The feature is
optional — without a bot token the stack starts exactly as before, the worker logs that it is
idle, and Settings explains why the section is disabled.

**1. Create a bot.** Talk to [@BotFather](https://t.me/BotFather): `/newbot` → display name →
username → he replies with a token.

**2. Point the app at it.** Configuration is read from `backend/.env`, not from
`docker-compose.yml`:

```bash
cp backend/.env.example backend/.env
# then fill in:
#   TELEGRAM_BOT_TOKEN=123456:AA...
#   TELEGRAM_BOT_USERNAME=my_notes_bot
make up
```

`backend/.env` is git-ignored — the token never enters the repository.

**3. Connect your account.** Open **Settings → Telegram reminders**, pick your time zone and
the time of day reminders should arrive, then press **Connect Telegram**. Telegram opens on the
bot; press **Start**. The bot confirms, and reminders are switched on automatically.

**4. That's it.** Any note with a date now produces one message at the chosen time, in your time
zone. Turning the toggle off, unlinking, archiving the note or clearing its date all stop it.

Delivery is exactly-once: the reminder is recorded in an outbox keyed by note and date, so a
restart, a retry after a Telegram rate limit, or a change of time zone cannot produce a second
message. See `docs/demo.md` for a minute-by-minute walkthrough and `docs/architecture.md` for
the design.

## Common commands

```bash
make help        # list all targets
make logs        # tail logs
make test        # run backend tests
make down        # stop the stack
make clean       # stop and wipe the database volume
```

## Layout

- `backend/` — FastAPI + SQLAlchemy + Alembic, talks to Postgres.
- `backend/scripts/worker.py` — Telegram long polling + reminder delivery, its own compose service.
- `frontend/` — React + Vite.
- `docker-compose.yml` — db + backend + worker + frontend.
