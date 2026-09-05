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

    # --- Trade Execution Engine (Tugas 2) ------------------------------ #
    # Saldo awal akun PAPER_TRADING (virtual).
    paper_start_balance_usdt: float = 10_000.0
    # Guardrail wajib — ditegakkan server, apa pun yang dikirim klien/AI.
    trade_max_risk_pct: float = 2.0          # risiko maksimum per trade (% equity)
    trade_leverage_cap: int = 3              # leverage maksimum
    trade_max_notional_usdt: float = 20_000.0  # nilai posisi maksimum (sanity ceiling)
    # LIVE_BINANCE mati secara default. Set TRADE_LIVE_ENABLED=true untuk
    # mengizinkan order sungguhan; tetap butuh confirm=true per request.
    trade_live_enabled: bool = False
    # Saat LIVE aktif, default ke testnet Binance Futures (aman untuk uji coba).
    binance_testnet: bool = True
    # Lokasi file penyimpanan akun & jurnal trade (persist antar-restart).
    # Produksi: ganti backend ke Supabase/Postgres lewat TradeStore interface.
    trade_store_path: str = "data/trade_store.json"

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
