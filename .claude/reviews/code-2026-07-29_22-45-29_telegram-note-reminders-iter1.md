# Code Review — telegram-note-reminders (iteration 1)

**Timestamp:** 2026-07-29 22:45:29
**Verdict:** `NEEDS_FIX`
**Iteration:** 1 of max 2
**Files reviewed:** 32 (+2859 / −16)
**Review scope:** `git diff main..HEAD` — рабочее дерево чистое, изменения в шести коммитах ветки
**Blocking findings:** 0
**Critical findings:** 4
**Minor findings:** 6
**Hard Rules violations:** — (проектного `CLAUDE.md` и `.claude/rules/` нет; правила брались из `docs/architecture.md`)

---

## Files Reviewed

| File | Changes | Контекст |
|---|---|---|
| `backend/scripts/worker.py` | +214 | прочитан целиком; вызывает `telegram_link`, `reminders`, `telegram` |
| `backend/app/reminders.py` | +217 | прочитан целиком; единственный caller — `worker.tick` |
| `backend/app/telegram_link.py` | +124 | callers: `routers/account.py`, `worker.process_updates` |
| `backend/app/telegram.py` | +95 | callers: `worker` |
| `backend/app/routers/account.py` | +66 | прочитан; consumer — `frontend/src/api.js` |
| `backend/app/models.py` | +65 | сверен с миграциями 0003/0004 |
| `backend/alembic/versions/000{3,4}_*.py` | +116 | сверены с моделью |
| `backend/app/config.py`, `schemas.py` | +50 | прочитаны |
| `frontend/src/pages/Settings.jsx` | +146 | прочитан; consumer `api.js` |
| `frontend/src/pages/Notes.jsx`, `components/NoteEditor.jsx` | +33 | проверена передача пропа |
| `docker-compose.yml` | +15 | сверен с `config.py` |
| тесты (5 файлов) | +938 | прочитаны на предмет покрытия новых путей |

---

## Findings by Dimension

### D1. Correctness

**C1 — offset продвигается до обработки: сбой БД навсегда теряет `/start`.**

`backend/scripts/worker.py:89-102`

```python
for update in updates:
    update_id = update.get("update_id")
    if isinstance(update_id, int):
        next_offset = update_id + 1        # продвинули ДО обработки
    db = SessionLocal()
    try:
        outcome = telegram_link.handle_start_command(db, update)
    except SQLAlchemyError:
        db.rollback()
        logger.exception("failed to handle update %s", update_id)
        continue                            # offset уже продвинут
    finally:
        db.close()
```

`next_offset` возвращается наружу и подтверждается следующим `getUpdates`. Если БД моргнула
(перезапуск Postgres, исчерпание пула, дедлок) — апдейт подтверждён в Telegram и **больше никогда
не придёт**. Пользователь нажал Start, бот промолчал, причины не видно.

Это ровно тот отказ, который модуль декларирует как недопустимый в собственном docstring
(`worker.py:83-85`): «discarding the backlog would silently swallow button presses». Сброса хвоста
нет, а потеря через ошибку БД — есть.

**Suggested fix:** продвигать `next_offset` только после успешной обработки, либо прерывать цикл
на первом сбое, не подтверждая остаток пачки. Второе проще и безопаснее: `break` вместо `continue`.

---

### D2. Integration

**C2 — `wait_for_schema()` проверяет не ту таблицу.**

`backend/scripts/worker.py:70`

```python
db.execute(text("SELECT 1 FROM users LIMIT 1"))
```

`users` появляется в миграции 0001, а воркеру нужна `reminders` из 0004. На чистом volume есть
окно, где 0001 применена, а 0004 ещё нет: `wait_for_schema` возвращает управление, воркер стартует,
первый же `tick()` падает на `relation "reminders" does not exist`.

Отказ не фатален — исключение ловится в `run()` и повторяется следующим тиком, — но проверка
готовности, пропускающая ровно тот случай, ради которого написана, бесполезна, и на старте в логи
летит ошибка, которая выглядит как настоящая.

**Suggested fix:** проверять `reminders` (самая поздняя таблица), либо спрашивать
`alembic_version` на равенство `head`.

---

### D3. Performance

**C3 — N+1 в `materialize_due`: 20 заметок → 79 SQL-запросов.**

`backend/app/reminders.py:66-112`

Измерено на живом окружении счётчиком `before_cursor_execute`:

```
20 заметок -> SQL-запросов в materialize_due: 79
expire_on_commit: True
```

Причина: `SessionLocal` создан без `expire_on_commit=False` (`backend/app/db.py:12`), а `commit()`
вызывается **внутри** цикла по заметкам. Каждый коммит помечает все загруженные объекты
устаревшими, поэтому обращение к `note.id` / `user.timezone` на следующей итерации порождает новый
SELECT. Плюс отдельный SELECT существующей строки и отдельный INSERT+COMMIT на каждую заметку.

Цикл выполняется каждые 30 секунд, а окно материализации — 72 часа заметок, так что стоимость
растёт линейно по числу датированных заметок всех пользователей с включёнными уведомлениями.

**Suggested fix:** одна выборка существующих строк за окно вместо `one_or_none()` на заметку, и
один `commit()` после цикла вместо коммита на итерацию. `IntegrityError`-страховку тогда обрабатывать
на уровне пачки.

**C4 — `resync_pending` и `cancel_stale` сканируют весь outbox без ограничений.**

`backend/app/reminders.py:115-137` и `153-177`

```python
.filter(Reminder.status == Reminder.STATUS_PENDING)
.all()
```

Ни `limit`, ни фильтра по `scheduled_for`. Каждые 30 секунд оба метода поднимают в память **все**
pending-строки и все связанные `Note` и `User`. Горизонт в 48 часов ограничивает рост косвенно, но
строки, застрявшие в `pending` после неудачных отправок, из выборки не уходят до тех пор, пока не
упрутся в `MAX_ATTEMPTS` или не протухнут.

**Suggested fix:** ограничить обе выборки окном `scheduled_for <= now + MATERIALIZE_HORIZON` и
добавить `limit`, симметричный `claim_batch`.

---

### D11. Test Coverage

**C1 (продолжение) — цикл поллинга не покрыт ни одним тестом.**

```
grep -rn "process_updates|wait_for_schema|worker.run" backend/tests/
(НЕТ НИ ОДНОГО ТЕСТА)
```

`worker.tick()` покрыт хорошо (13 тестов), а `process_updates`, `wait_for_schema` и `run` — нулём.
Это не случайность: `pytest.ini` меряет `--cov=app`, а `scripts/` вне охвата, поэтому пробел не
виден в метрике (94.6%). Ровно тот риск, который зафиксирован в `docs/architecture.md`, — и он
реализовался: единственный Critical-баг корректности (C1) сидит в непокрытой функции.

**Suggested fix:** тест на `process_updates` с подставным клиентом: продвижение offset,
пропуск апдейта без чата, поведение при `SQLAlchemyError` (после фикса C1 — offset не должен
проскочить).

---

### D4. Error Handling

Чисто по существу. Отмечено в Minor: молчаливая потеря подтверждающего ответа при 429 (M1).

### D5. Dead Code / Bloat

Чисто. Все новые модули импортируются, неиспользуемых экспортов нет.

### D6. Failure Mode / Blast Radius

Чисто. Воркер изолирован: его падение не влияет на API и фронт, стек поднимается без токена.

### D7. Code Health

Чисто. `account.py` вырос с 50 до ~116 строк, остался связным; доменная логика вынесена в `app/`.

### D8. Abstraction Level

Чисто. `TelegramClient` как Protocol оправдан — используется тремя разными фейками в тестах.

### D9. Reuse / DRY

Чисто. `still_deliverable` переиспользован в `cancel_stale` и в `tick`, дублирования условий нет.

### D10. Security

Чисто по существу; см. M5 про дублирование дефолтного `JWT_SECRET`. Токен не попадает ни в
исключения, ни в логи (логгер `httpx` приглушён), `backend/.env` под `.gitignore`, `chat_id` наружу
не отдаётся, все новые эндпойнты за `get_current_user`.

### D12. Maintainability

Чисто. Комментарии объясняют «почему», а не «что»; названия однозначны.

---

## Minor Findings

- **M1** `backend/scripts/worker.py:109-110` — при `TelegramRetryAfter` на ответном сообщении код
  спит и идёт дальше, не повторяя отправку. Привязка уже зафиксирована, но пользователь
  подтверждения не получает и не понимает, сработало ли.
- **M2** `backend/app/reminders.py:76, 129` — `except Exception` вокруг `compute_scheduled_for`
  слишком широк. Ожидается `ZoneInfoNotFoundError`/`ValueError`; в текущем виде проглотит и
  `KeyboardInterrupt`-подобные вещи из `BaseException`-соседей и любую ошибку программиста.
- **M3** `frontend/src/pages/Settings.jsx:143` — `onChange` на `input[type=time]` шлёт PATCH на
  каждое валидное изменение: смена часа и минуты — два запроса. Дебаунса нет.
- **M4** `frontend/src/pages/Notes.jsx:52-64` — ошибка загрузки настроек пишется в общий `error`
  страницы заметок, из-за чего сбой второстепенной подсказки выглядит как отказ списка заметок.
- **M5** `docker-compose.yml:25,44` — дефолтный `JWT_SECRET` теперь захардкожен дважды (backend и
  worker). Паттерн унаследован от scaffold, но копия удваивает место, которое надо не забыть
  поменять.
- **M6** `backend/scripts/worker.py:127-151` — `claim_batch` берёт блокировку `FOR UPDATE`, но
  `mark_sent`/`mark_failed` коммитят внутри цикла и снимают её с остатка пачки. При одной реплике
  безвредно, но инвариант «пачка заблокирована на время обработки» не держится, а комментарий это
  не оговаривает.

---

## Blast Radius Analysis

Всё найденное живёт в воркере и в модуле напоминаний — отдельном процессе, который не обслуживает
HTTP-запросы. API, аутентификация и работа с заметками не затронуты: падение воркера не роняет
приложение, а без токена он просто простаивает.

Практические последствия, если выкатить как есть: пользователь может нажать Start и не получить
привязку (C1, при сбое БД, без следа кроме traceback); на старте с чистой БД в логи попадает
ложная ошибка (C2); нагрузка на Postgres растёт линейно по числу датированных заметок и бьёт
каждые 30 секунд (C3, C4). Данные не повреждаются, дубли сообщений не возникают — гарантия
exactly-once держится на UNIQUE-констрейнте и не зависит ни от одного из findings.

---

## Verdict Rationale

Ноль BLOCKING: инвариант «ровно одно сообщение» защищён констрейнтом БД, security-поверхность
чистая, blast radius ограничен отдельным процессом.

Четыре Critical: один баг корректности, теряющий пользовательское действие (C1), бесполезная
проверка готовности (C2) и два запроса, которые не масштабируются (C3 — измерено, 79 запросов на
20 заметок; C4). Показательно, что C1 сидит именно в функции, у которой ноль тестов, и что этот
пробел не виден в покрытии 94.6% — `--cov=app` не смотрит в `scripts/`.

---

## Next Action

**NEEDS_FIX** → ship-it, iteration 2. Взять C1–C4; Minor по желанию пользователя.
