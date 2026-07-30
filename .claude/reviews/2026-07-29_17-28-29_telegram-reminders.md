# Plan Review — telegram-reminders

**Timestamp:** 2026-07-29 17:28:29
**Verdict:** `APPROVE_WITH_CHANGES`
**Complexity:** HIGH
**Plan source:** `.claude/plans/current-plan.md`
**Original plan snapshot:** `.claude/reviews/2026-07-29_17-28-29_telegram-reminders_original-plan.md`
**Files touched (по плану):** ~25
**Probed assumptions:** 16
**Failed assumptions:** 3
**Applied fixes:** 11

---

## Assumption Register

| # | Assumption | Проверка | Статус |
|---|---|---|---|
| 1 | Ревизии Alembic — простые строки `0001`/`0002`, имя `0003_*` впишется | `cat alembic/versions/*.py` | ✅ `revision = "0001"`, `down_revision = "0001"` |
| 2 | `env.py` регистрирует модели и `Base.metadata` | `cat alembic/env.py` | ✅ `from app import models`, `compare_type=True` |
| 3 | Существующие миграции добавляют NOT NULL только с `server_default` | `0001_init.py` | ✅ паттерн есть — план его не воспроизводил |
| 4 | `NoteEditor.jsx` — presentational, без fetch | `cat components/NoteEditor.jsx` | ✅ чистые props, ноль вызовов api |
| 5 | `Notes.jsx` передаёт в `NoteEditor` только колбэки | `grep -n NoteEditor -A15 pages/Notes.jsx` | ✅ note/onSave/onCancel/onDelete/onPin/onArchive |
| 6 | `httpx.MockTransport` доступен | выполнено в контейнере | ✅ работает, мок-ответ получен |
| 7 | `Intl.supportedValuesOf('timeZone')` есть во фронт-рантайме | `node -e` в контейнере frontend | ✅ Node 20.20.2, 418 зон |
| 8 | Compose поддерживает `env_file: required: false` | `docker compose config` с отсутствующим файлом | ✅ конфиг валиден без `backend/.env` |
| 9 | `${TELEGRAM_BOT_TOKEN:-}` даёт «переменная не задана» | `docker compose config` | ❌ **даёт `TOKEN: ""`** — пустая строка, не unset |
| 10 | Coverage меряет воркер | `pytest.ini` → `--cov=app`; вывод покрытия | ❌ **`scripts/` вне охвата**, воркер не измеряется |
| 11 | Порог покрытия под угрозой из-за объёма нового кода | арифметика: 373 stmt / 94.37% сейчас | ❌ **риск переоценён** — даже 60% на новом коде даёт ~84% |
| 12 | `zoneinfo` + tzdata в образе | `available_timezones()` | ✅ 486 зон |
| 13 | `httpx` уже в зависимостях | `import httpx` | ✅ 0.28.1 |
| 14 | `with_for_update(skip_locked=True)` не падает на SQLite | выполнено на sqlite | ✅ игнорируется молча |
| 15 | `make lint` красный до правок | `make lint` | ✅ `tests/test_auth.py:90` |
| 16 | В проекте нет `CLAUDE.md` / `.claude/rules/` | `ls` | ✅ отсутствуют → Hard Rules берутся из `docs/architecture.md` |

---

## Findings by Dimension

### D1. Domain Model Audit

**C1 — UNIQUE(note_id, scheduled_for) не даёт заявленной идемпотентности.**
План одновременно утверждает «`UniqueConstraint('note_id','scheduled_for')` — это и есть гарантия "не уйдёт дважды"» и «Смена таймзоны пользователем до отправки сдвигает время». Эти два утверждения несовместимы: при смене таймзоны `compute_scheduled_for` вернёт другое значение, `materialize_due` вставит **вторую** строку (констрейнт не нарушен, ключ другой), а первая останется `pending`. Пользователь получает два сообщения об одной заметке — ровно то, что ТЗ называет главным требованием.

Тот же дефект срабатывает при смене `reminder_time` в настройках.

**Fix:** ключ идемпотентности — стабильный, а не вычисляемый. `UniqueConstraint('note_id', 'note_date')` (одно напоминание на заметку на дату), колонка `note_date` дублируется в `reminders` как occurrence key. `scheduled_for` становится изменяемым полем: если строка существует и `status='pending'` — пересчитать и **обновить** её, а не вставлять новую.

### D2. Cross-Component Pipeline

**H1 — подсказка в `NoteEditor.jsx` требует данных, которых в компоненте нет.**
Phase 2 предписывает «`NoteEditor.jsx` — подсказка "напоминание придёт в HH:MM"... Только чтение состояния, без новых эндпойнтов». Проверено: `NoteEditor` — `forwardRef`-компонент на чистых props (`note`, `onSave`, `onCancel`, `onDelete`, `onPin`, `onArchive`), ни одного обращения к `api.js`. Настройки пользователя туда физически не доходят. Нарушение зафиксированного правила `docs/architecture.md`: *«Frontend `components/*` stay presentational; fetching lives in `pages/*`»*.

**Fix:** `Notes.jsx` (страница) грузит настройки и передаёт `reminderHint` пропом в `NoteEditor`.

**M1 — не описан источник списка таймзон для select.**
План вводит выбор таймзоны в UI, но не говорит откуда берётся список. Проверено: `Intl.supportedValuesOf('timeZone')` доступен во фронт-рантайме (418 зон), эндпойнт для этого не нужен. Бэкенд валидирует по `zoneinfo` (486 зон) — надмножество, конфликта нет.

### D6. Failure Mode Analysis

**C2 — пустая строка вместо `None` при отсутствующем токене.**
`docker compose config` подтвердил: `${TELEGRAM_BOT_TOKEN:-}` подставляет `TOKEN: ""`. pydantic-settings увидит переменную как заданную, и `telegram_bot_token` станет `""`, а не `None`. Любая проверка `is None` даст ложный результат, а `bot_configured` начнёт зависеть от того, какую из двух проверок написали. Это тихая деградация — прямое нарушение правила NO FALLBACKS.

**Fix:** `field_validator(mode='before')` в `config.py`, нормализующий пустую/пробельную строку в `None`. Плюс явный тест.

**M2 — не описана отмена уже материализованных напоминаний.**
План проверяет условия только в момент материализации. Между материализацией и отправкой пользователь может: заархивировать заметку, поменять/стереть `note_date`, выключить уведомления, отвязать Telegram. Во всех четырёх случаях `pending`-строка всё равно отправится. Особенно скверен случай смены даты: старая строка выстрелит в старую дату.

**Fix:** claim-шаг перепроверяет актуальность (join к `notes`/`users`), неактуальные строки переводятся в `cancelled`. Добавлен статус `cancelled`.

**M3 — не описан протухший `pending`.**
Окно backfill применяется только при материализации. Если воркер лежал три дня, накопленные `pending` отправятся при старте с трёхдневным опозданием. Окно должно применяться и на отправке.

**M4 — коллизия `telegram_chat_id` не обработана.**
Колонка unique. Второй пользователь, привязывающий тот же Telegram-аккаунт, получит `IntegrityError` → 500. Нужен явный 409 с внятным текстом.

**M5 — `bot_configured` при половинчатой настройке.**
Задан токен, не задан username → deep-link собирается битым. Нужно `bot_configured = bool(token and username)`.

### D3. Cost / Resource Profile

**C3 — insert-and-catch как основной механизм, а не как страховка.**
`materialize_due` описан как «вставляет строку, `IntegrityError` → откат и пропуск». На установившемся режиме это значит: каждые 30 секунд — попытка вставки для **каждой** уже материализованной заметки, каждая из которых откатывает транзакцию. Мусор в логах Postgres, лишние round-trip'ы, рост счётчиков `xact_rollback`.

**Fix:** отбор кандидатов через `NOT EXISTS` по `reminders`, а `IntegrityError` остаётся страховкой от гонки двух воркеров — вторичным механизмом, а не первичным.

### D11. Output Verification

**C4 — риск покрытия сформулирован неверно, и это меняет тест-стратегию.**
План пишет: «Покрытие ≥80% — воркер и клиент это заметный объём нового кода». Проверено: `pytest.ini` задаёт `--cov=app`, вывод покрытия перечисляет только `app/*`. `scripts/worker.py` **не измеряется вообще**. Последствия двоякие: (а) риск непопадания в порог переоценён — арифметика даёт ~84% даже при слабом покрытии нового кода в `app/`; (б) гораздо важнее то, что план не заметил: любая логика, уехавшая в `worker.py`, выпадает из-под метрики совсем. Это превращает «держать воркер тонким» из стилистического предпочтения в требование.

### D7. Code Health Impact

Чисто. `account.py` — 50 строк, места достаточно. Новые модули (`telegram.py`, `reminders.py`) не утяжеляют существующие файлы.

### D9. Existing Implementation

Напоминаний в кодовой базе нет. `app/rate_limit.py` — референс антипаттерна (in-memory dict), план осознанно его не повторяет. `notes.py:_now()` дублирует будущий `_now` в `reminders.py` — мелочь, не выношу в правки.

### D12. Prior Art / Build vs Adopt

Чисто. Research отработал: `httpx` вместо telegram-фреймворка, outbox вместо Celery/APScheduler, обоснования и отвергнутые варианты зафиксированы.

### D4, D5, D8, D10

Чисто.

---

## Hard Rules Violations

Проектного `CLAUDE.md` и `.claude/rules/` нет. Источник правил — раздел *«Dependency rules worth keeping»* в `docs/architecture.md` плюс постоянные правила пользователя.

### H1. Fetching в presentational-компоненте
- **Rule:** `docs/architecture.md` — «Frontend `components/*` stay presentational; fetching lives in `pages/*`»
- **Where in plan:** Phase 2, `NoteEditor.jsx`
- **Fix applied:** данные грузит `Notes.jsx`, в `NoteEditor` приходит проп `reminderHint`

### H2. NO FALLBACKS — тихая деградация на пустом токене
- **Rule:** постоянное правило пользователя — не деградировать молча, не подставлять дефолты
- **Where in plan:** Phase 1, `config.py`
- **Fix applied:** нормализация `""` → `None` валидатором + тест; `bot_configured` требует и токен, и username

### H3. Worktree для нетривиальных задач
- **Rule:** постоянное правило пользователя — задачи с >2 файлами ведутся в отдельном worktree, squash merge в конце
- **Where in plan:** отсутствовал как шаг (упоминание ветки было только в Risks)
- **Fix applied:** шаг 0 в Phase 1 — worktree от `main`

---

## Critical Findings

### C1. Ключ идемпотентности вычисляемый, а не стабильный
- **Dimension:** D1
- **Applied:** Yes — `UniqueConstraint('note_id','note_date')`, `scheduled_for` обновляется у pending-строки

### C2. Пустая строка вместо None при отсутствующем токене
- **Dimension:** D6
- **Applied:** Yes — валидатор в `config.py` + тест

### C3. Insert-and-catch как первичный механизм
- **Dimension:** D3
- **Applied:** Yes — `NOT EXISTS`-фильтр, `IntegrityError` понижен до страховки от гонки

### C4. Неверная формулировка риска покрытия
- **Dimension:** D11
- **Applied:** Yes — риск переписан: `scripts/` вне `--cov=app`, отсюда требование держать логику в `app/`

---

## Missing Steps (applied)

- **M1** — источник списка таймзон (`Intl.supportedValuesOf`) — добавлен в Phase 1
- **M2** — отмена неактуальных `pending` (архив / смена даты / выключенные уведомления / отвязка) + статус `cancelled` — добавлено в Phase 2
- **M3** — окно протухания на отправке, не только на материализации — добавлено в Phase 2
- **M4** — 409 при попытке привязать уже занятый `telegram_chat_id` — добавлено в Phase 1
- **M5** — `bot_configured = token AND username` — добавлено в Phase 1

---

## Applied Fixes (summary)

- **[C1]** ключ идемпотентности `(note_id, note_date)` вместо `(note_id, scheduled_for)`; pending-строка обновляется
- **[C2]** нормализация пустого env-var в `None` + тест
- **[C3]** отбор кандидатов через `NOT EXISTS`
- **[C4]** риск покрытия переписан по факту `--cov=app`
- **[H1]** fetch настроек уехал из `NoteEditor` в `Notes.jsx`
- **[H2]** `bot_configured` требует оба env-var
- **[H3]** worktree как шаг 0
- **[M1]** список таймзон из `Intl.supportedValuesOf`
- **[M2]** статус `cancelled` + перепроверка на claim
- **[M3]** протухание pending на отправке
- **[M4]** 409 на занятый chat_id

---

## Second pass — ревью применённых правок (2026-07-29 17:4x)

### C5 — фикс C1 вводил собственный тупик: `cancelled` навсегда блокирует ключ

- **Dimension:** D1 / D6
- **Problem:** после [C1] ключом стал `(note_id, note_date)`, а [M2] ввёл статус `cancelled`. Вместе они дают невозвратное состояние: строка `cancelled` продолжает занимать ключ, поэтому `NOT EXISTS` отфильтрует заметку, а прямая вставка упадёт на констрейнте. Сценарий: пользователь сдвинул дату с 1 на 5 августа (строка за 1-е ушла в `cancelled`), затем вернул на 1-е — напоминание не придёт **никогда**, молча.
- **Evidence:** `UniqueConstraint('note_id','note_date')` + `cancel_stale` переводит в `cancelled`, не удаляя строку.
- **Recommendation:** материализация как upsert по ключу — `cancelled` при вернувшихся условиях реактивируется в `pending` с пересчитанным `scheduled_for`, `sent` не трогается. Партиальный уникальный индекс `WHERE status <> 'cancelled'` отвергнут: Postgres-специфика, ломает SQLite-тесты.
- **Applied:** Yes — в `materialize_due` добавлена реактивация + два acceptance criteria.

### Прочее по второму проходу

`resync_pending` / `cancel_stale` / `materialize_due` частично пересекаются по ответственности и на этапе имплементации могут схлопнуться в одну функцию-reconcile. Не выношу в правки: план технически рабочий, а выбор формы — за ship-it.

Остальные 10 правок повторную проверку прошли без замечаний.

---

## Внешние факты, появившиеся после ревью

- Токен бота получен и проверен через `getMe`: бот `MadDev BOT`, username `maddev_test_bot`, `ok: true`. Сохранён в `backend/.env` — покрыт `.gitignore:8`, в `git status` не появляется. Единственная внешняя зависимость плана (риск «нужен токен от @BotFather») снята.
- **[U1]** получил фактуру: `getMe` отдаёт username штатно, так что автоопределение технически подтверждено. Решение всё равно за пользователем — план по умолчанию оставлен на двух env-var.

---

## Unresolved (требует решения пользователя)

- **[U1] Два env-var или автоопределение username через `getMe`.** Альтернатива — при старте воркера один раз дёрнуть `getMe`, взять username оттуда и убрать `TELEGRAM_BOT_USERNAME` совсем: одна переменная вместо двух, невозможно рассогласовать. Цена — сетевой вызов на старте и ещё один путь отказа. Оба варианта жизнеспособны, архитектурный выбор за тобой. По умолчанию в плане оставлены два env-var.
- **[U2] Коммитить ли `.claude/` в ветку задания.** Директории нет в `.gitignore`, значит план, research и этот отчёт уедут в форк. Для задания, где отдельным пунктом просят «чем делал и почему», показанный процесс скорее плюс — но это решение, а не умолчание.

---

## Verdict Rationale

Ни одной галлюцинированной сущности: все файлы, поля, ревизии миграций и API проверены чтением кода и выполнением в живом контейнере. Архитектура (outbox в Postgres, отдельный воркер, тонкий httpx-клиент) выдержала все 12 dimensions. Но три проверки провалились, и одна из них — вычисляемый ключ идемпотентности — ломала главное требование ТЗ ровно в том сценарии, который план сам же вносил в acceptance criteria. Все дефекты чинятся патчем без пересмотра подхода, поэтому не BLOCK.

---

## Next Action

Перечитать обновлённый план, затем `/ship-it`. Верификацию (реальный бот, видео) вести отдельной сессией — по постоянному правилу «тестирование не в той же сессии, что разработка».
