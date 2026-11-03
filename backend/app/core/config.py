from datetime import date, datetime
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(ROOT / ".env", ROOT / "backend" / ".env"), extra="ignore")

    app_name: str = "RubiCore"
    tagline: str = "Track Your Day. Understand Your Money. Explore the World."
    environment: str = "development"
    database_url: str = f"sqlite:///{(ROOT / 'database' / 'rubicore.db').as_posix()}"
    secret_key: str = "dev-insecure-change-me"
    access_token_minutes: int = 60 * 12
    cookie_secure: bool = False
    cors_origins: str = "http://localhost:3000"
    timezone: str = "Asia/Kolkata"
    default_currency: str = "INR"

    # LLM: gemini | ollama | none
    llm_provider: str = "gemini"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.1"

    # Provider adapters (public data)
    stock_provider: str = "yahoo"
    news_provider: str = "rss"

    # Rate limits (requests per minute per client IP)
    rate_limit_default: int = 240
    rate_limit_auth: int = 10
    rate_limit_chat: int = 20

    # No accounts, passwords or sign-up: one owner, opened with this PIN (APP_PIN in .env) or with an enrolled face.
    app_pin: str = "1224"
    pin_max_failures: int = 5
    pin_lockout_minutes: int = 5

    # Face lock
    face_lock_idle_minutes: int = 10
    face_max_failures: int = 5
    face_lockout_minutes: int = 5

    mcp_config_path: str = str(ROOT / "mcp" / "config" / "servers.json")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


def now_local() -> datetime:
    return datetime.now(ZoneInfo(settings.timezone))


def today() -> date:
    return now_local().date()
