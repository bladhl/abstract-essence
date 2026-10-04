from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ESSENCE_", env_file=".env", extra="ignore")
    database_url: str = "postgresql+psycopg://essence:local-essence-only@127.0.0.1:5547/essence"
    redis_url: str = "redis://127.0.0.1:6381/0"
    allowed_origins: list[str] = [
        "http://127.0.0.1:4201",
        "http://localhost:4201",
        "http://127.0.0.1:8001",
    ]
    openai_models: list[str] = []
    google_models: list[str] = []
    anthropic_models: list[str] = []
    openai_api_key: SecretStr = SecretStr("")
    google_api_key: SecretStr = SecretStr("")
    anthropic_api_key: SecretStr = SecretStr("")
