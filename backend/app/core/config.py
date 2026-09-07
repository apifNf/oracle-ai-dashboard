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

    # --- Market Intelligence (Misi 1 + Terminal Institusional) ------ #
    # Ambang WHALE ALERT (🚨) untuk transaksi on-chain / eksekusi CEX (USD).
    whale_threshold_usd: float = 500_000.0
    # Ambang minimum yang masuk ke aliran terminal on-chain (flow besar).
    # Diturunkan dari 250k: stream Bybit (`publicTrade`) mengirim fill mentah
    # tanpa agregasi ala Binance `@aggTrade` (worker menggabungkannya per pesan),
    # jadi notional per event cenderung lebih kecil. 🚨 WHALE ALERT tetap di
    # whale_threshold_usd (500k).
    whale_stream_min_usd: float = 120_000.0
    # Endpoint JSON-RPC Ethereum publik (tanpa API key). Boleh dioverride.
    eth_rpc_url: str = "https://ethereum-rpc.publicnode.com"
    # Interval polling worker (detik).
    rss_poll_seconds: int = 180
    onchain_poll_seconds: int = 20
    # CryptoCompare / CoinDesk Data — Alpha News real-time. Kalau kosong,
    # NewsWorker fallback ke RSS publik (CoinDesk/Cointelegraph/Decrypt/…).
    cryptocompare_api_key: str | None = None
    news_poll_seconds: int = 120

    # --- Trade Execution Engine (Tugas 2) ------------------------------ #
    # Saldo awal akun PAPER_TRADING (virtual).
    paper_start_balance_usdt: float = 10_000.0
    # Guardrail wajib — ditegakkan server, apa pun yang dikirim klien/AI.
    trade_max_risk_pct: float = 2.0          # risiko maksimum per trade (% equity)
    trade_leverage_cap: int = 3              # leverage maksimum
    trade_max_notional_usdt: float = 20_000.0  # nilai posisi maksimum (sanity ceiling)
    # LIVE trading mati secara default. Set TRADE_LIVE_ENABLED=true untuk
    # mengizinkan order sungguhan; tetap butuh confirm=true per request.
    trade_live_enabled: bool = False
    # Saat LIVE aktif, default ke sandbox/testnet exchange (aman untuk uji coba).
    exchange_testnet: bool = True
    binance_testnet: bool = True  # alias lama (dipertahankan utk kompatibilitas)

    # --- Auto-Trade lintas bursa (Workspace Configuration) ------------ #
    # Bursa & tipe pasar default kalau request tidak menyertakannya.
    default_exchange_id: str = "binance"       # binance|okx|bybit|mexc|indodax
    default_market_type: str = "spot"          # spot|futures
    # SaaS PUBLIK / NON-CUSTODIAL: kunci bursa dikirim per-request dari browser
    # user dan SELALU menang. Kredensial `.env` di bawah hanya jaring pengaman
    # untuk deployment single-tenant/dev. Set EXCHANGE_ALLOW_SERVER_KEYS=false di
    # deployment publik supaya eksekusi MURNI memakai kunci milik user sendiri —
    # tidak ada trader yang tanpa sadar memakai akun bursa operator.
    exchange_allow_server_keys: bool = True
    # Kredensial "Primary Exchange" generik (dipakai untuk exchange apa pun).
    # Untuk Binance, binance_api_key/secret di atas juga dipakai sebagai fallback.
    exchange_api_key: str | None = None
    exchange_api_secret: str | None = None
    exchange_api_password: str | None = None   # sebagian bursa (OKX) butuh passphrase
    # Lokasi file penyimpanan akun & jurnal trade (persist antar-restart).
    # Produksi: ganti backend ke Supabase/Postgres lewat TradeStore interface.
    trade_store_path: str = "data/trade_store.json"

    # --- Monetisasi: Coinbase Commerce billing (Fase Monetisasi) ------ #
    coinbase_commerce_api_key: str | None = None
    coinbase_commerce_webhook_secret: str | None = None
    pro_price_usd: str = "49.00"
    pro_period_days: int = 30
    # Batas prompt/hari untuk tier FREE (Pro = unlimited).
    free_prompt_daily_limit: int = 3
    # Model FABLE 5 khusus Pro (prioritas quant reasoning).
    fable5_model_pro: str = "claude-opus-5"
    # URL yang dibuka setelah checkout Coinbase selesai / dibatalkan.
    billing_redirect_url: str = "http://localhost:3001/ai-chat?upgraded=1"
    billing_cancel_url: str = "http://localhost:3001/ai-chat?upgrade=cancelled"
    user_store_path: str = "data/user_store.json"
    billing_store_path: str = "data/billing_store.json"

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
