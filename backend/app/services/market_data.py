"""
backend/app/services/market_data.py

ORACLE :: MarketDataService
Data pasar publik dari CoinGecko. Tidak membutuhkan kredensial user.

Prinsip desain:
  - TIDAK PERNAH mengembalikan angka karangan. Kegagalan direpresentasikan
    lewat field `status`, bukan lewat price=0.
  - Cache dulu, jaringan belakangan. Ini obat rate-limit yang sebenarnya.
  - Batching: 30 aset = 1 request, bukan 30 request.
  - Data basi yang jujur (dengan umurnya) selalu lebih berguna daripada
    "N/A" atau nol palsu.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import time
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Iterable, Optional, Sequence

import httpx

logger = logging.getLogger(__name__)

__all__ = ["MarketDataService", "MarketStatus"]

# --------------------------------------------------------------------------- #
# Konfigurasi
# --------------------------------------------------------------------------- #

DEMO_BASE_URL = "https://api.coingecko.com/api/v3"
PRO_BASE_URL = "https://pro-api.coingecko.com/api/v3"

FRESH_TTL_SECONDS = 60        # di bawah ini: sajikan cache tanpa memanggil jaringan
STALE_TTL_SECONDS = 900       # 60s–900s: sajikan cache dengan status "stale"
CACHE_PREFIX = "oracle:mkt:v1:"

REQUEST_TIMEOUT = 10.0
MAX_ATTEMPTS = 3
MIN_REQUEST_INTERVAL = 1.2    # throttle antar panggilan keluar (detik)
MAX_IDS_PER_REQUEST = 250     # batas per_page CoinGecko


class MarketStatus(str, Enum):
    """Status kualitas data. UI dan prompt AI wajib membaca field ini."""

    OK = "ok"                          # segar, dari jaringan atau cache muda
    STALE = "stale"                    # dari cache, provider sedang gagal
    UNAVAILABLE = "unavailable"        # tidak ada data sama sekali
    UNKNOWN_SYMBOL = "unknown_symbol"  # simbol tidak ada di peta


class MarketDataService:
    COIN_MAP: dict[str, str] = {
        "BTC": "bitcoin",
        "ETH": "ethereum",
        "SOL": "solana",
        "BNB": "binancecoin",
        "XRP": "ripple",
        "ADA": "cardano",
        "HYPE": "hyperliquid",
    }

    # ---------------------- konstruksi ----------------------------------- #

    def __init__(
        self,
        redis_client: Any | None = None,
        api_key: str | None = None,
        *,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        """
        redis_client : instance redis.asyncio.Redis (opsional).
                       Tanpa ini, cache hanya per-proses; dengan banyak worker
                       di Render, tiap worker punya cache sendiri dan jumlah
                       panggilan keluar berlipat. Gunakan Redis di produksi.
        api_key      : default dari env COINGECKO_API_KEY.
        """
        self._redis = redis_client
        self._memory_cache: dict[str, dict[str, Any]] = {}

        self._api_key = api_key or os.getenv("COINGECKO_API_KEY") or ""
        self._is_pro = os.getenv("COINGECKO_PLAN", "demo").strip().lower() == "pro"
        self._base_url = PRO_BASE_URL if self._is_pro else DEMO_BASE_URL

        self._client = client
        self._owns_client = client is None

        self._throttle_lock = asyncio.Lock()
        self._last_request_ts = 0.0

        if not self._api_key:
            logger.warning(
                "COINGECKO_API_KEY tidak di-set. Endpoint tanpa kunci dibatasi "
                "sangat ketat dan akan sering kena 429."
            )

    def _build_headers(self) -> dict[str, str]:
        # User-Agent jujur. Menyamar sebagai Chrome tidak melewati pembatasan
        # berbasis IP dan melanggar ToS provider.
        headers = {
            "Accept": "application/json",
            "User-Agent": "ORACLE-Dashboard/1.0 (+backend service)",
        }
        if self._api_key:
            name = "x-cg-pro-api-key" if self._is_pro else "x-cg-demo-api-key"
            headers[name] = self._api_key
        return headers

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=httpx.Timeout(REQUEST_TIMEOUT),
                headers=self._build_headers(),
                limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
            )
        return self._client

    async def aclose(self) -> None:
        """Panggil di FastAPI lifespan shutdown."""
        if self._client is not None and self._owns_client:
            await self._client.aclose()
            self._client = None

    # ---------------------- cache ---------------------------------------- #

    async def _cache_get(self, symbol: str) -> dict[str, Any] | None:
        key = f"{CACHE_PREFIX}{symbol}"

        if self._redis is not None:
            try:
                raw = await self._redis.get(key)
                if raw:
                    return json.loads(raw)
            except Exception as exc:
                # Redis mati bukan alasan untuk menggagalkan request.
                logger.warning("Cache read gagal untuk %s: %s", symbol, type(exc).__name__)

        return self._memory_cache.get(key)

    async def _cache_set(self, symbol: str, payload: dict[str, Any]) -> None:
        key = f"{CACHE_PREFIX}{symbol}"
        self._memory_cache[key] = payload

        if self._redis is not None:
            try:
                await self._redis.set(key, json.dumps(payload), ex=STALE_TTL_SECONDS)
            except Exception as exc:
                logger.warning("Cache write gagal untuk %s: %s", symbol, type(exc).__name__)

    # ---------------------- HTTP ----------------------------------------- #

    async def _throttle(self) -> None:
        async with self._throttle_lock:
            elapsed = time.monotonic() - self._last_request_ts
            if elapsed < MIN_REQUEST_INTERVAL:
                await asyncio.sleep(MIN_REQUEST_INTERVAL - elapsed)
            self._last_request_ts = time.monotonic()

    async def _fetch_markets(self, coin_ids: Sequence[str]) -> list[dict[str, Any]]:
        """
        Satu panggilan untuk banyak koin. Melempar httpx.HTTPError atau
        RuntimeError bila semua percobaan gagal.
        """
        client = await self._get_client()
        params = {
            "vs_currency": "usd",
            "ids": ",".join(coin_ids),
            "per_page": str(min(len(coin_ids), MAX_IDS_PER_REQUEST)),
            "page": "1",
            "sparkline": "false",
            "price_change_percentage": "24h",
        }

        last_error: Exception | None = None

        for attempt in range(1, MAX_ATTEMPTS + 1):
            await self._throttle()
            try:
                response = await client.get("/coins/markets", params=params)

                if response.status_code == 429:
                    retry_after = self._parse_retry_after(response)
                    logger.warning(
                        "CoinGecko 429 (percobaan %d/%d), tunggu %.1fs",
                        attempt, MAX_ATTEMPTS, retry_after,
                    )
                    last_error = RuntimeError("rate_limited")
                    if attempt < MAX_ATTEMPTS:
                        await asyncio.sleep(retry_after)
                    continue

                if response.status_code in (401, 403):
                    # Kunci salah/kedaluwarsa. Retry tidak akan menolong.
                    raise RuntimeError(f"auth_failed_{response.status_code}")

                if response.status_code >= 500:
                    last_error = RuntimeError(f"upstream_{response.status_code}")
                    if attempt < MAX_ATTEMPTS:
                        await asyncio.sleep(self._backoff(attempt))
                    continue

                response.raise_for_status()
                payload = response.json()

                if not isinstance(payload, list):
                    # CoinGecko membalas dict error, bukan array.
                    raise RuntimeError("unexpected_payload_shape")

                return payload

            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_error = exc
                logger.warning(
                    "Jaringan gagal (percobaan %d/%d): %s",
                    attempt, MAX_ATTEMPTS, type(exc).__name__,
                )
                if attempt < MAX_ATTEMPTS:
                    await asyncio.sleep(self._backoff(attempt))

        raise last_error or RuntimeError("fetch_failed")

    @staticmethod
    def _backoff(attempt: int) -> float:
        """Exponential backoff dengan jitter penuh."""
        return min(2 ** attempt, 8) * (0.5 + random.random() / 2)

    @staticmethod
    def _parse_retry_after(response: httpx.Response) -> float:
        raw = response.headers.get("Retry-After")
        if raw:
            try:
                return min(float(raw), 30.0)
            except ValueError:
                pass
        return 5.0

    # ---------------------- API publik ----------------------------------- #

    async def get_coins_data(self, symbols: Iterable[str]) -> dict[str, dict[str, Any]]:
        """
        Ambil banyak simbol sekaligus. Ini jalur utama; pakai ini untuk scanner.

        Return: {"BTC": {...}, "ETH": {...}}
        Setiap nilai selalu dict valid dengan field `status`.
        """
        wanted = [s.strip().upper() for s in symbols if s and s.strip()]
        results: dict[str, dict[str, Any]] = {}
        now = time.time()

        # 1. Simbol tak dikenal ditolak eksplisit, bukan diam-diam jadi bitcoin.
        known: list[str] = []
        for sym in wanted:
            if sym not in self.COIN_MAP:
                results[sym] = self._unknown_symbol_payload(sym)
            else:
                known.append(sym)

        # 2. Cache muda -> tidak usah menyentuh jaringan.
        need_fetch: list[str] = []
        cached: dict[str, dict[str, Any]] = {}
        for sym in known:
            entry = await self._cache_get(sym)
            if entry is None:
                need_fetch.append(sym)
                continue
            cached[sym] = entry
            age = now - entry.get("fetched_at", 0)
            if age < FRESH_TTL_SECONDS:
                results[sym] = self._render(entry, MarketStatus.OK, age)
            else:
                need_fetch.append(sym)

        if not need_fetch:
            return results

        # 3. Satu panggilan jaringan untuk sisa simbol.
        id_to_symbol = {self.COIN_MAP[s]: s for s in need_fetch}
        try:
            rows = await self._fetch_markets(list(id_to_symbol.keys()))
        except Exception as exc:
            reason = self._classify(exc)
            logger.error(
                "Pengambilan data pasar gagal untuk %d simbol: %s",
                len(need_fetch), reason,
            )
            for sym in need_fetch:
                results[sym] = self._degraded(sym, cached.get(sym), reason, now)
            return results

        returned: set[str] = set()
        for row in rows:
            coin_id = row.get("id")
            sym = id_to_symbol.get(coin_id)
            if sym is None:
                continue
            entry = self._normalize(sym, row, now)
            await self._cache_set(sym, entry)
            results[sym] = self._render(entry, MarketStatus.OK, 0.0)
            returned.add(sym)

        # 4. Simbol yang diminta tapi tidak dibalas provider.
        for sym in need_fetch:
            if sym not in returned:
                results[sym] = self._degraded(
                    sym, cached.get(sym), "not_returned_by_provider", now
                )

        return results

    async def get_coin_data(self, symbol: str) -> dict[str, Any]:
        """Versi satu simbol. Kompatibel dengan pemanggil lama."""
        sym = (symbol or "").strip().upper()
        if not sym:
            return self._unknown_symbol_payload("")
        batch = await self.get_coins_data([sym])
        return batch[sym]

    # ---------------------- pembentuk payload ---------------------------- #

    @staticmethod
    def _normalize(symbol: str, row: dict[str, Any], now: float) -> dict[str, Any]:
        return {
            "symbol": symbol,
            "price": row.get("current_price"),
            "change_24h": row.get("price_change_percentage_24h"),
            "market_cap": row.get("market_cap"),
            "volume_24h": row.get("total_volume"),
            "high_24h": row.get("high_24h"),
            "low_24h": row.get("low_24h"),
            "fetched_at": now,
        }

    @staticmethod
    def _render(entry: dict[str, Any], status: MarketStatus, age: float) -> dict[str, Any]:
        return {
            "symbol": entry["symbol"],
            "status": status.value,
            "price": entry.get("price"),
            "change_24h": entry.get("change_24h"),
            "market_cap": entry.get("market_cap"),
            "volume_24h": entry.get("volume_24h"),
            "high_24h": entry.get("high_24h"),
            "low_24h": entry.get("low_24h"),
            "source": "coingecko",
            "as_of": datetime.fromtimestamp(
                entry.get("fetched_at", 0), tz=timezone.utc
            ).isoformat(),
            "age_seconds": int(age),
            "error": None,
        }

    def _degraded(
        self,
        symbol: str,
        cached: dict[str, Any] | None,
        reason: str,
        now: float,
    ) -> dict[str, Any]:
        """
        Provider gagal. Dua kemungkinan jujur:
          - ada cache dalam jendela stale -> sajikan dengan umurnya
          - tidak ada -> UNAVAILABLE dengan price=None. BUKAN nol.
        """
        if cached is not None:
            age = now - cached.get("fetched_at", 0)
            if age <= STALE_TTL_SECONDS:
                payload = self._render(cached, MarketStatus.STALE, age)
                payload["error"] = {"code": reason, "message": "Data dari cache."}
                return payload

        return {
            "symbol": symbol,
            "status": MarketStatus.UNAVAILABLE.value,
            "price": None,
            "change_24h": None,
            "market_cap": None,
            "volume_24h": None,
            "high_24h": None,
            "low_24h": None,
            "source": "coingecko",
            "as_of": None,
            "age_seconds": None,
            "error": {"code": reason, "message": "Data pasar tidak tersedia."},
        }

    @staticmethod
    def _unknown_symbol_payload(symbol: str) -> dict[str, Any]:
        return {
            "symbol": symbol,
            "status": MarketStatus.UNKNOWN_SYMBOL.value,
            "price": None,
            "change_24h": None,
            "market_cap": None,
            "volume_24h": None,
            "high_24h": None,
            "low_24h": None,
            "source": None,
            "as_of": None,
            "age_seconds": None,
            "error": {
                "code": "unknown_symbol",
                "message": f"Simbol '{symbol}' tidak ada di COIN_MAP.",
            },
        }

    @staticmethod
    def _classify(exc: Exception) -> str:
        text = str(exc)
        if "rate_limited" in text:
            return "rate_limited"
        if "auth_failed" in text:
            return "auth_failed"
        if "upstream_" in text:
            return "upstream_error"
        if isinstance(exc, httpx.TimeoutException):
            return "timeout"
        if isinstance(exc, httpx.TransportError):
            return "network_error"
        return "unknown_error"

    # ---------------------- jembatan ke layer chat AI -------------------- #

    @staticmethod
    def to_context_line(payload: dict[str, Any]) -> str:
        """
        Ubah payload menjadi satu baris untuk prompt AI.

        Ini yang menghilangkan "N/A" di UI chat: model menerima kalimat yang
        menjelaskan situasinya, bukan placeholder kosong atau nol palsu.
        """
        symbol = payload.get("symbol", "?")
        status = payload.get("status")

        if status == MarketStatus.UNKNOWN_SYMBOL.value:
            return f"{symbol}: tidak didukung sistem (tidak terdaftar di peta aset)."

        if status == MarketStatus.UNAVAILABLE.value:
            code = (payload.get("error") or {}).get("code", "unknown")
            note = {
                "rate_limited": "penyedia data sedang membatasi permintaan",
                "auth_failed": "kredensial penyedia data bermasalah",
                "timeout": "penyedia data tidak merespons",
                "network_error": "gangguan jaringan",
            }.get(code, "gangguan penyedia data")
            return (
                f"{symbol}: harga TIDAK TERSEDIA saat ini ({note}). "
                f"Jangan mengarang angka; sampaikan bahwa data belum bisa diambil."
            )

        price = payload.get("price")
        change = payload.get("change_24h")
        change_txt = f"{change:+.2f}%" if isinstance(change, (int, float)) else "n/d"
        price_txt = f"${price:,.4f}" if isinstance(price, (int, float)) else "n/d"

        if status == MarketStatus.STALE.value:
            age_min = (payload.get("age_seconds") or 0) // 60
            return (
                f"{symbol}: {price_txt} ({change_txt} 24j) — DATA BASI, "
                f"terakhir diperbarui {age_min} menit lalu. Sebutkan keterlambatan ini."
            )

        return f"{symbol}: {price_txt} ({change_txt} 24j), data terkini."

    @classmethod
    def to_context_block(cls, payloads: dict[str, dict[str, Any]]) -> str:
        return "\n".join(cls.to_context_line(p) for p in payloads.values())