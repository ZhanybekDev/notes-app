from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_WEAK_JWT_SECRETS = {
    "change-me",
    "change-me-in-production",
    "changeme",
    "default",
    "replace-with-at-least-32-random-characters",
    "secret",
    "test-secret",
}


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/notes"
    jwt_secret: str
    jwt_expire_minutes: int = 60 * 24
    cors_origins: str = "http://localhost:5173"
    telegram_bot_token: str | None = None
    reminder_timezone: str = "UTC"
    telegram_poll_timeout_seconds: int = 30
    reminder_poll_interval_seconds: int = 60

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator("jwt_secret")
    @classmethod
    def validate_jwt_secret(cls, value: str) -> str:
        secret = value.strip()
        if secret.lower() in _WEAK_JWT_SECRETS or len(secret) < 32:
            raise ValueError(
                "JWT_SECRET must be at least 32 characters and must not use a placeholder value"
            )
        return secret

    @field_validator("telegram_bot_token")
    @classmethod
    def normalize_telegram_bot_token(cls, value: str | None) -> str | None:
        if value is None:
            return None
        token = value.strip()
        return token or None

    @field_validator("reminder_timezone")
    @classmethod
    def validate_reminder_timezone(cls, value: str) -> str:
        timezone_name = value.strip() or "UTC"
        try:
            ZoneInfo(timezone_name)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"Unknown REMINDER_TIMEZONE: {timezone_name}") from exc
        return timezone_name

    @field_validator("telegram_poll_timeout_seconds", "reminder_poll_interval_seconds")
    @classmethod
    def validate_positive_seconds(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("Poll intervals must be positive")
        return value


settings = Settings()
