from __future__ import annotations

from collections import defaultdict, deque
from time import monotonic

from fastapi import HTTPException, Request, status

_MAX_ATTEMPTS = 5
_WINDOW_SECONDS = 5 * 60
_attempts: dict[str, deque[float]] = defaultdict(deque)

# Public reads are counted on every hit, not only on failures, because the thing being defended
# against is enumeration of share tokens rather than password guessing. Generous enough that a
# person opening a link, refreshing and sending it to a colleague never notices.
_PUBLIC_MAX_REQUESTS = 60
_PUBLIC_WINDOW_SECONDS = 60
_public_hits: dict[str, deque[float]] = defaultdict(deque)


def auth_rate_limit_key(request: Request, purpose: str, subject: str | int) -> str:
    client_host = request.client.host if request.client else "unknown"
    return f"{purpose}:{client_host}:{str(subject).strip().lower()}"


def check_auth_rate_limit(key: str) -> None:
    now = monotonic()
    attempts = _attempts[key]
    while attempts and now - attempts[0] > _WINDOW_SECONDS:
        attempts.popleft()
    if len(attempts) >= _MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Try again later.",
        )


def record_auth_failure(key: str) -> None:
    check_auth_rate_limit(key)
    _attempts[key].append(monotonic())


def clear_auth_failures(key: str) -> None:
    _attempts.pop(key, None)


def reset_auth_rate_limits() -> None:
    _attempts.clear()
    _public_hits.clear()


def check_public_rate_limit(request: Request) -> None:
    """Throttle unauthenticated reads per client address.

    Same in-process weakness as the auth limiter it sits next to — the counters do not survive a
    restart and are not shared between uvicorn workers — but the alternative here is nothing at
    all, and a token is 43 characters of entropy, so this bounds a nuisance rather than being the
    only thing standing between an attacker and the data.
    """
    client_host = request.client.host if request.client else "unknown"
    hits = _public_hits[client_host]
    now = monotonic()
    while hits and now - hits[0] > _PUBLIC_WINDOW_SECONDS:
        hits.popleft()
    if len(hits) >= _PUBLIC_MAX_REQUESTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Try again in a minute.",
        )
    hits.append(now)
