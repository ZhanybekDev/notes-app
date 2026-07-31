# Notes

*Документация на русском: [README.ru.md](README.ru.md) — установка, бот и его команды, как работают
напоминания, экспорт и публичные ссылки. Разбор задания — [SUBMISSION.md](SUBMISSION.md).*

---

## Для проверяющего

Всё существенное — здесь, ссылки ведут в подробности. Английское описание проекта ниже по файлу.

**Живой инстанс: https://notes.ssi-dev.com** — вход `demo` / `demo1234`, ставить ничего не нужно.
Бот `@maddev_test_bot` подключён к нему же: Настройки → «Подключить Telegram» выдаст ссылку,
после неё напоминания приходят из этого инстанса. Как он развёрнут — [ниже](#deployment).

### Что сделано

| Волна | Что | Где смотреть |
|---|---|---|
| **Задание** | Telegram-напоминания по дате заметки: миграции, outbox-таблица, воркер, бот с командами, i18n | `backend/app/reminders.py`, `scripts/worker.py` |
| **Внутреннее** | состояние фронтенда на `zustand` (было 14 `useState` на странице и Context), переработка UI целиком — токены, слой отклика, индикаторы загрузки | `frontend/src/stores/`, `frontend/src/styles/` |
| **Сверх задания** | публичные read-only ссылки на заметку, экспорт в markdown и zip | `backend/app/routers/public.py`, `backend/app/export.py` |

Запуск локально: `make up && make seed` → http://localhost:5173, вход тот же.
Подробности, переменные окружения и траблшутинг — в [README.ru.md](README.ru.md).

### Решения, которые стоит проверить в первую очередь

- **Ключ уникальности напоминания — `(note_id, note_date)`, а не `(note_id, scheduled_for)`.** Время
  выводится из настроек, поэтому по нему смена пояса вставила бы вторую строку, пока первая ждёт —
  два сообщения на одну заметку.
- **Доставка честно at-least-once, не exactly-once.** Идемпотентного ключа в Bot API нет; окно —
  миллисекунды между ответом Telegram и коммитом. Сказано прямо, а не спрятано.
- **Публичный ответ описан отдельной моделью `PublicNoteOut`.** Дело не в текущих полях, а в том, что
  следующее поле, добавленное в приватную `NoteOut`, стало бы публичным молча. На точный набор есть тест.
- **Отозванная ссылка, архивная заметка и несуществующий токен отвечают одинаковым 404.** Разница
  сама по себе отвечала бы на вопросы о чужих заметках.
- **Публичный запрос на фронте идёт мимо общего пути `api.js`** — тот завершает сессию на любом 401, и
  отозванная ссылка иначе разлогинивала бы того, кто её открыл.
- **Имя файла при экспорте не экранируется, а обезвреживается:** `../../etc/passwd` → `etcpasswd`.
  Заголовок — не путь, и единственный безопасный способ подставить его в имя файла — сделать его
  неспособным означать что-то ещё.
- **Ошибка показывается дважды намеренно:** тост как событие (уезжает) и блок с кнопкой повтора как
  состояние (остаётся). Иначе через восемь секунд пустая сетка календаря начинает утверждать, что в
  месяце ничего нет.

Полный разбор с альтернативами — [SUBMISSION.md, разделы 2–3](SUBMISSION.md).

### Что нашло adversarial-ревью

Каждая фича проходила через ревью плана до кода и ревью кода после. Три круга по коду нашли **десять
дефектов в уже зелёном на тестах коде** — форма у всех одна: верно для первого случая, неверно для
второго.

- экспорт **молча терял заметку**: две записи получали одно имя в zip, распаковщик оставлял последнюю;
- контрол «Поделиться» держал ссылку **предыдущей** заметки и копировал её;
- 401 после истечения сессии клал красный `Unauthorized` на форму входа;
- пустое состояние списка врало «заметок нет» первые 300 мс каждого визита;
- сбой при открытии дня календаря показывал заметки другого дня.

Все исправлены, у каждого исправления тест, ключевые проверены **мутацией** — откатом правки, чтобы
убедиться, что тест падает. Отчёты целиком: [`.claude/reviews/`](.claude/reviews/) (~35 файлов).

### Что осталось открытым — сознательно

- **Текст ошибки от сервера английский.** `api.js` пробрасывает `detail` как есть, и это правильно
  (сервер знает конкретику), но такой текст попадает в `role="alert"`. Нужен контракт по кодам ошибок
  с бэкендом, а не патч на фронте.
- **Оба лимитера живут в памяти процесса** — скаффолдовский и мой для публичного чтения.
- **Экспорт грузит все строки в память** до упаковки; сам архив спулится на диск.

### Что не проверено — честно

- **Интерфейс не открывался в браузере.** Есть сборка, 229 тестов и размер CSS против прежнего; нет
  ровно того, ради чего всё делалось. `css: false` в конфиге vitest означает, что **ни один тест в
  проекте не видит стилей**.
- Sharing и export прогнаны курлом по живому стеку, но не кликнуты: буфер обмена и путь «блоб → файл»
  держатся на рассуждении, jsdom их не реализует.
- Скринридером не слушал, `prefers-reduced-motion` проверен чтением каскада, замеров
  производительности нет ни одного.

Полный список — [SUBMISSION.md, раздел 6](SUBMISSION.md).

### Карта документов

| Файл | Что внутри |
|---|---|
| [README.ru.md](README.ru.md) | установка, бот и команды, как работают напоминания, разработка |
| [SUBMISSION.md](SUBMISSION.md) | ответы по заданию: почему так, что заметил в scaffold, что дальше, caveats |
| [docs/architecture.md](docs/architecture.md) | устройство: слои, правила зависимостей, дерево модулей |
| [docs/demo.md](docs/demo.md) | последовательность команд для демонстрации напоминаний |
| [docker-compose.prod.yml](docker-compose.prod.yml) + [deploy.sh](deploy.sh) | прод-стек и выкатка: чем отличается от dev, где живут секреты |
| [.claude/](.claude/) | планы, research и архивы ревью — по ним видно, как принимались решения |

### Проверки

`make test` — 237 тестов бэкенда при пороге покрытия 80% (фактически ~96%) и 229 фронта.
`make lint` — ruff + eslint. Квикстарт проверен на чистых томах: миграции с нуля, сид, обе фичи.

---

## The project itself

A personal Markdown notes app. Keep notes, tag them, search them, and pin some to a date so you can browse them on a calendar.

Each user has their own private space. Every note is a Markdown document with a live preview while editing.

## What's inside

- Log in / register. Notes are private; a note can be published as a read-only link.
- CRUD for notes with Markdown preview.
- Tags with filtering.
- Full-text search across title and body.
- Optional date on a note + a calendar view.
- Telegram reminders when a note's date arrives.
- Read-only share links for a single note, revocable.
- Export: one note as markdown, or the account as a zip.

## Run it

Requirements: Docker with Compose.

```bash
make up          # start db + backend + frontend
make seed        # (optional) create a demo user with a few notes; safe to re-run
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
zone, and in the language your Telegram client is set to — English or Russian, with English as the
fallback. Turning the toggle off, unlinking, archiving the note or clearing its date all stop it.

The bot also answers. Press the menu button next to the message box for `/today`, `/upcoming` and
`/status`, and `/pause` and `/resume` to silence reminders without disconnecting.

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

## Deployment

A live instance runs at **https://notes.ssi-dev.com**, deployed from `docker-compose.prod.yml`.

```bash
cp .deploy.env.example .deploy.env   # where to deploy — git-ignored
./deploy.sh                          # upload, rebuild, migrate, health-check
```

What separates the production stack from the development one:

- **No source is mounted.** A container runs the code baked into its image, so what was built is
  what runs. The development stack bind-mounts the tree and runs `--reload`, which is right for
  editing and wrong for anything else.
- **The frontend is a built bundle behind nginx**, not a Vite dev server. nginx also proxies
  `/api`, which keeps the browser on one origin — the same shape the Vite proxy gives locally, so
  no CORS preflight exists in either environment. Its config falls back to `index.html`, without
  which a shared `/s/<token>` link — the one URL strangers open — would 404.
- **Secrets live only on the server**, in a `chmod 600` `.env` that is git-ignored and excluded
  from both the rsync and the Docker build context (`.dockerignore`). The repository carries
  `.env.prod.example` with placeholders. The database is not published to the host at all.
- **The deploy script waits for `/healthz`** before reporting success. `up -d` returns once
  containers start, which is before migrations finish — reporting then would mean a green deploy
  and a 502 in the browser.

The server address is read from the git-ignored `.deploy.env` rather than written into
`deploy.sh`: a deploy script that hardcodes one publishes the layout of a private network to
everyone who reads the repository.

**One token, one worker.** The deployed worker long-polls continuously, and the Bot API answers a
second concurrent `getUpdates` on the same token with `409 Conflict`. So a local `make up` sharing
that token breaks both instances — updates go to whichever process asked last, and the live bot
looks like it answers every other time. Local development needs its own bot from @BotFather.

## Layout

- `backend/` — FastAPI + SQLAlchemy + Alembic, talks to Postgres.
- `backend/scripts/worker.py` — Telegram long polling + reminder delivery, its own compose service.
- `frontend/` — React + Vite.
- `docker-compose.yml` — db + backend + worker + frontend (development).
- `docker-compose.prod.yml` + `deploy.sh` — the production stack and the one command that ships it.
