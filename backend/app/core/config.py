from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    project_name: str = "ORACLE"
    environment: str = "local"
    api_v1_prefix: str = "/api/v1"
    backend_cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    database_url: str = "postgresql+psycopg://oracle:oracle@localhost:5432/oracle"

    # --- Model providers -------------------------------------------------- #
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None

    binance_api_key: str | None = None
    binance_api_secret: str | None = None

    # --- Dual-model AI router (Misi 3) ---------------------------------- #
    # TIER 1 = percakapan umum / sapaan / istilah dasar.
    # TIER 2 = "FABLE 5", reasoning engine kuant (Claude Sonnet/Opus).
    tier1_model: str = "gpt-4o"
    fable5_model: str = "claude-sonnet-5"

    # --- Market Intelligence (Misi 1) --------------------------------- #
    # Ambang transaksi whale on-chain dalam USD.
    whale_threshold_usd: float = 500_000.0
    # Endpoint JSON-RPC Ethereum publik (tanpa API key). Boleh dioverride.
    eth_rpc_url: str = "https://ethereum-rpc.publicnode.com"
    # Interval polling worker (detik).
    rss_poll_seconds: int = 300
    onchain_poll_seconds: int = 20

    @field_validator("backend_cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
