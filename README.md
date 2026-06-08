# Notes

## Telegram reminder smoke test

Use this exact sequence to prove that the bot sends a real reminder message to Telegram:

```bash
cp backend/.env.example backend/.env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \\n')/" backend/.env
printf '\nTELEGRAM_BOT_TOKEN=%s\nREMINDER_TIMEZONE=UTC\n' "<your-bot-token>" >> backend/.env
make up
make seed

# 1) Log in as the demo user and copy the access_token from the JSON response.
curl -s -X POST http://localhost:8000/api/auth/login \
  -d 'username=demo&password=demo1234' \
  -H 'Content-Type: application/x-www-form-urlencoded'

# 2) Generate a Telegram link code using that token.
TOKEN="<paste-access-token-here>"
curl -s -X POST http://localhost:8000/api/account/telegram/link \
  -H "Authorization: Bearer $TOKEN"

# 3) In Telegram, send the returned command to your bot:
#    /start <link_code>

# 4) Force one reminder delivery pass.
make remind-once
```

Expected result: after `/start <link_code>` links your chat, the seeded note **Telegram smoke test** (dated for today) is delivered by the bot when `make remind-once` runs.

A personal Markdown notes app. Keep notes, tag them, search them, and pin some to a date so you can browse them on a calendar.

Each user has their own private space. Every note is a Markdown document with a live preview while editing.

## What's inside

- Log in / register (single-user-per-account — no sharing).
- CRUD for notes with Markdown preview.
- Tags with filtering.
- Full-text search across title and body.
- Optional date on a note + a calendar view.
- Optional Telegram reminders for dated notes.

## Run it

Requirements: Docker with Compose.

```bash
make up          # start db + backend + bot + frontend
make seed        # (optional) create a demo user with a few notes
```

Then open <http://localhost:5173>.

`make up` will create `backend/.env` from `backend/.env.example` on first run so the backend and bot services share the same settings file.

Demo credentials (after `make seed`):

- **username:** `demo`
- **password:** `demo1234`

## Telegram reminders

Telegram support is optional. The stack still starts without a bot token, but the Settings page will show the integration as unavailable.

To enable the bot locally:

```bash
cp backend/.env.example backend/.env
printf '\nTELEGRAM_BOT_TOKEN=%s\nREMINDER_TIMEZONE=UTC\n' "<your-bot-token>" >> backend/.env
make up
make seed
```

Then:

1. Open Settings and generate a Telegram link code.
2. Send `/start <code>` to your bot in Telegram.
3. Create or reuse a note dated for today.
4. Run `make remind-once` to force one reminder delivery pass.

## Common commands

```bash
make help        # list all targets
make logs        # tail logs
make test        # run backend tests
make down        # stop the stack
make clean       # stop and wipe the database volume
```

## Layout

- `backend/` — FastAPI + SQLAlchemy + Alembic, plus the Telegram reminder worker.
- `frontend/` — React + Vite.
- `docker-compose.yml` — db + backend + bot + frontend.
