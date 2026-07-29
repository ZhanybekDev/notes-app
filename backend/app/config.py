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
    telegram_bot_username: str | None = None

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

    @field_validator("telegram_bot_token", "telegram_bot_username", mode="before")
    @classmethod
    def blank_to_none(cls, value: object) -> object:
        # `.env.example` ships these keys with no value, so a copied `.env` yields "" rather
        # than an absent key. Without this, `is None` checks silently report "configured".
        if isinstance(value, str):
            stripped = value.strip().lstrip("@")
            return stripped or None
        return value

    @property
    def bot_configured(self) -> bool:
        return bool(self.telegram_bot_token and self.telegram_bot_username)


settings = Settings()
