# Research — telegram-reminders

**Timestamp:** 2026-07-29
**Task classification:** integration (внешний сервис — Telegram Bot API) + new-module (фоновый воркер)
**Research triggered:** yes

## Summary

Задача закрывается без единой новой зависимости: `httpx` уже установлен в образе (0.28.1), `zoneinfo` работает из коробки (486 таймзон в `python:3.11-slim`). Telegram Bot API — это два HTTP-вызова (`getUpdates`, `sendMessage`), тянуть `python-telegram-bot`/`aiogram` в синхронный SQLAlchemy-проект неоправданно. Идемпотентность строится на outbox-таблице с UNIQUE-констрейнтом и `SELECT ... FOR UPDATE SKIP LOCKED` — проверено, что на SQLite (тестовый диалект) это не падает, а молча игнорируется.

## Current best practices (2026)

- **Long polling с timeout 25–30 с.** `timeout=0` — это short polling, он молотит серверы Telegram. Продакшн-значение 30–60 с.
- **Offset = max(update_id) + 1.** Апдейт считается подтверждённым, как только `getUpdates` вызван с offset выше его `update_id`. Пересчитывать после каждого ответа, иначе дубли.
- **Старт с `offset=-1`** возвращает только последний апдейт, не потребляя очередь — удобно для «сброса» накопившегося хвоста при старте воркера.
- **`limit` 1–100**, по умолчанию 100.
- **Глобальный лимит — 30 сообщений/сек на токен**, не менялся с 2019.
- **429 отдаёт `retry_after` в секундах — уважать буквально.** Telegram не принимает дробный backoff и продлевает бан, если долбиться раньше срока.
- **С layer 167 (февраль 2025) `retry_after` стал per-chat, а не per-token.** Флуд в один чат ловит 429 быстрее, чем та же нагрузка, размазанная по 1000 личных чатов.
- **Комбинировать проактивный rate limit и реактивный retry.** Очередь предотвращает 429, retry ловит те, что просочились.
- Для локальной разработки и тестов long polling однозначно выигрывает у webhook (не нужен публичный URL / туннель).

## Ready-made solutions (libraries)

### Candidate 1: httpx (уже в проекте)
- **Статус:** `httpx>=0.26` уже в `backend/requirements.txt`, в контейнере стоит 0.28.1
- **Fit for our case:** high
- **Pros:** ноль новых зависимостей; синхронный `httpx.Client` ложится на синхронный код проекта; `MockTransport` даёт тестирование клиента без сети и без monkeypatch-хаков
- **Cons:** методы Bot API описываем руками (нужны ровно два)

### Candidate 2: python-telegram-bot
- **Fit for our case:** low
- **Pros:** полное покрытие Bot API, готовый `Application`/`JobQueue`
- **Cons:** async-first со своим event loop — конфликтует с синхронным SQLAlchemy-кодом проекта; тянет `apscheduler`, `tornado` и хвост зависимостей ради двух вызовов; поднимает порог входа для ревьюера

### Candidate 3: aiogram
- **Fit for our case:** low
- **Cons:** те же async-проблемы, плюс это фреймворк с собственной моделью роутинга — избыточен для `/start` и одного `sendMessage`

**Отвергнуто:** APScheduler / Celery / Redis как планировщик. Celery+Redis — это ещё один брокер и ещё один контейнер ради одного цикла раз в 30 секунд. APScheduler держит расписание в памяти процесса, что не переживает рестарт и не даёт идемпотентности — а именно её ТЗ называет требованием. Таблица-outbox в уже существующем Postgres решает и планирование, и идемпотентность, и живучесть после рестарта одним механизмом.

## Common pitfalls

- **Дубли при рестарте воркера** — если offset не персистить, после падения `getUpdates` отдаст неподтверждённые апдейты заново. Для `/start`-привязки это безопасно (идемпотентная операция), для отправки — нет, поэтому отправка не должна зависеть от offset вообще.
- **Двойная отправка при нескольких репликах воркера** — лечится claim-запросом `FOR UPDATE SKIP LOCKED` внутри транзакции.
- **Двойная отправка при `--reload`** — uvicorn с `--reload` перезапускает процесс на каждое изменение файла. Именно поэтому воркер должен быть отдельным сервисом, а не lifespan-таском внутри backend.
- **Наивная арифметика таймзон** — `date + time` в наивном datetime и последующее `astimezone` даёт сдвиг. Правильно: `datetime.combine(note_date, reminder_time, tzinfo=ZoneInfo(user.timezone))` → сразу aware, затем в UTC.
- **DST** — в переходные сутки локальное время может не существовать или существовать дважды. `zoneinfo` разрешает это детерминированно (`fold`), но факт надо оговорить.
- **Backfill старых заметок** — при первом запуске воркера все прошлые заметки с датами внезапно станут «просроченными». Нужно окно отсечки (не слать старше N часов), иначе пользователь получает лавину.
- **Токен в логах** — `TELEGRAM_BOT_TOKEN` попадает в URL запроса. Логировать URL нельзя.

## Verified assumptions (проверено на живом контейнере)

| Проверка | Команда | Результат |
|---|---|---|
| `zoneinfo` доступен, tzdata есть | `python -c "from zoneinfo import available_timezones"` | ✅ 486 таймзон |
| `httpx` уже установлен | `python -c "import httpx"` | ✅ 0.28.1 |
| `FOR UPDATE SKIP LOCKED` не ломает SQLite-тесты | `select(Note).with_for_update(skip_locked=True)` на sqlite | ✅ выполняется, диалект молча игнорирует |
| baseline `make test` | `make test` | ✅ 31 backend (94.37% cov) + 9 frontend |
| baseline `make lint` | `make lint` | ❌ `ruff format --check` падает на `tests/test_auth.py:90` |
| Compose поддерживает `env_file: required: false` | `docker compose version` | ✅ v2.40.3 (нужно ≥2.24) |

## Existing code in project

- `backend/app/config.py` — pydantic-settings, единственная точка входа для env-vars. Новые настройки идут сюда (`docs/architecture.md` требует этого явно).
- `backend/app/rate_limit.py` — уже существующий in-memory rate limiter. **Антипаттерн-референс:** модульный `dict`, не переживает рестарт и не работает при нескольких процессах. Повторять этот подход для «уже отправленных напоминаний» нельзя — отсюда и outbox в БД.
- `backend/app/routers/account.py` — 50 строк, естественный дом для настроек уведомлений и привязки Telegram.
- `backend/scripts/seed.py` — идемпотентный сид (удаляет демо-юзера, создаёт заново). Паттерн для повторного использования.
- `backend/tests/conftest.py` — фикстура `client` на SQLite-файле, `dependency_overrides`. Все новые API-тесты строятся на ней.
- `frontend/src/i18n.jsx` — один объект `MESSAGES` с ветками `en`/`ru`, dotted-ключи, интерполяция `{name}`.
- `frontend/src/api.js` — единственный модуль, вызывающий `fetch`.

## Recommendation

**Подход:** свой тонкий клиент на `httpx` (два метода Bot API) + outbox-таблица в Postgres + отдельный сервис-воркер в compose.

**Почему:** ноль новых зависимостей; идемпотентность и переживание рестарта решаются средствами БД, которая уже есть; отдельный процесс не конфликтует с `--reload` бэкенда и соблюдает записанное в `docs/architecture.md` правило «backend exposes HTTP only, no background jobs».

**Не делаем:** webhook (нужен публичный URL), Celery/Redis (лишний брокер), APScheduler (память процесса вместо БД), python-telegram-bot/aiogram (async-фреймворк в синхронном проекте).

## Sources

- [Telegram Bot API — official](https://core.telegram.org/bots/api)
- [getUpdates Telegram Bot: 5 Proven Fixes for 2026 — BotHero](https://blog.bothero.ai/getupdates-telegram-bot-the-polling-method-that-powers-43-of-small-business-bots-why-it-breaks-at-scale-and-what-to-do-about-it)
- [getUpdates — GramIO](https://gramio.dev/telegram/methods/getupdates)
- [How to solve rate limit errors from Telegram Bot API — GramIO](https://gramio.dev/rate-limits)
- [Telegram Bot API Rate Limits Explained (2026) — Bot Name Finder](https://botnamefinder.com/blog/telegram-bot-rate-limits-explained)
- [Fixing 429 Errors: Practical Retry Policies for Telegram Bot API](https://telegramhpc.com/news/574/)
