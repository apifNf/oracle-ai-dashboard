from __future__ import annotations

import asyncio
import logging
import math
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

import httpx
import pandas as pd

logger = logging.getLogger(__name__)

__all__ = ["IndicatorEngine", "IndicatorStatus"]

# --------------------------------------------------------------------------- #
# Konfigurasi
# --------------------------------------------------------------------------- #

FETCH_LIMIT = 300           # diambil dari bursa
WARMUP_DISCARD = 50         # dibuang dari depan; hasilnya tidak dipakai
MIN_CANDLES_REQUIRED = 120  # setelah pembuangan warm-up, minimal segini
CHART_TAIL = 45

RSI_PERIOD = 14
EMA_FAST = 20
EMA_SLOW = 50

REQUEST_TIMEOUT = 10.0

_INTERVAL_SECONDS = {
    "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
    "1h": 3600, "4h": 14400, "1d": 86400,
}


class IndicatorStatus(str, Enum):
    OK = "ok"
    UNAVAILABLE = "unavailable"                    # tidak ada sumber yang berhasil
    INSUFFICIENT_HISTORY = "insufficient_history"  # data ada tapi terlalu pendek
    UNKNOWN_SYMBOL = "unknown_symbol"
    BLOCKED_BY_MARKET_STATUS = "blocked_by_market_status"  # gerbang dari MarketDataService


class IndicatorEngine:

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._client = client
        self._owns_client = client is None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(REQUEST_TIMEOUT),
                headers={
                    "Accept": "application/json",
                    "User-Agent": "ORACLE-Dashboard/1.0 (+backend service)",
                },
                limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None and self._owns_client:
            await self._client.aclose()
            self._client = None

    # ---------------------- normalisasi simbol --------------------------- #

    @staticmethod
    def _binance_symbol(symbol: str) -> str:
        return symbol.replace("/", "").replace("_", "").upper()

    @staticmethod
    def _gate_symbol(symbol: str) -> str:
        cleaned = symbol.replace("/", "_").upper()
        if "_" not in cleaned:
            for quote in ("USDT", "USDC", "USD"):
                if cleaned.endswith(quote):
                    cleaned = f"{cleaned[: -len(quote)]}_{quote}"
                    break
        return cleaned

    # ---------------------- pengambilan klines --------------------------- #

    async def fetch_klines(self, symbol: str, interval: str = "1h") -> dict[str, Any]:
        """
        {"status": ..., "frame": DataFrame|None, "source": str|None, "error": {...}|None}
        """
        if interval not in _INTERVAL_SECONDS:
            return {
                "status": IndicatorStatus.UNAVAILABLE,
                "frame": None,
                "source": None,
                "error": {"code": "bad_interval", "message": f"Interval '{interval}' tidak didukung."},
            }

        errors: list[str] = []

        for source, fetcher in (
            ("binance", self._fetch_binance),
            ("gateio", self._fetch_gateio),
        ):
            try:
                frame = await fetcher(symbol, interval)
            except Exception as exc:
                # Dicatat, bukan ditelan diam-diam seperti `except: pass`.
                logger.warning(
                    "Sumber %s gagal untuk %s: %s", source, symbol, type(exc).__name__
                )
                errors.append(f"{source}:{type(exc).__name__}")
                continue

            if frame is None or frame.empty:
                errors.append(f"{source}:empty")
                continue

            frame = self._sanitize(frame, interval)
            if frame is None:
                logger.error("Data %s untuk %s gagal validasi OHLC.", source, symbol)
                errors.append(f"{source}:ohlc_invalid")
                continue

            if source == "gateio":
                logger.info("Fallback: %s diambil dari Gate.io, bukan Binance.", symbol)

            return {
                "status": IndicatorStatus.OK,
                "frame": frame,
                "source": source,
                "error": None,
            }

        return {
            "status": IndicatorStatus.UNAVAILABLE,
            "frame": None,
            "source": None,
            "error": {"code": "all_sources_failed", "message": "; ".join(errors)},
        }

    async def _fetch_binance(self, symbol: str, interval: str) -> pd.DataFrame | None:
        client = await self._get_client()
        response = await client.get(
            "https://api.binance.com/api/v3/klines",
            params={
                "symbol": self._binance_symbol(symbol),
                "interval": interval,
                "limit": FETCH_LIMIT,
            },
        )
        if response.status_code == 400:
            return None  # simbol tidak ada di Binance
        response.raise_for_status()
        rows = response.json()
        if not isinstance(rows, list) or not rows:
            return None

        # index: 0 open_time, 1 open, 2 high, 3 low, 4 close, 5 volume, 6 close_time
        return pd.DataFrame(
            [
                [int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])]
                for r in rows
            ],
            columns=["timestamp", "open", "high", "low", "close", "volume"],
        )

    async def _fetch_gateio(self, symbol: str, interval: str) -> pd.DataFrame | None:
        client = await self._get_client()
        response = await client.get(
            "https://api.gateio.ws/api/v4/spot/candlesticks",
            params={
                "currency_pair": self._gate_symbol(symbol),
                "interval": interval,
                "limit": FETCH_LIMIT,
            },
        )
        response.raise_for_status()
        rows = response.json()
        if not isinstance(rows, list) or not rows:
            return None

        # index: 0 unix_sec, 1 quote_volume, 2 close, 3 high, 4 low, 5 open, 6 base_volume
        return pd.DataFrame(
            [
                [
                    int(float(r[0])) * 1000,
                    float(r[5]), float(r[3]), float(r[4]), float(r[2]),
                    float(r[6]) if len(r) > 6 else 0.0,
                ]
                for r in rows
            ],
            columns=["timestamp", "open", "high", "low", "close", "volume"],
        )

    # ---------------------- pembersihan & validasi ----------------------- #

    @staticmethod
    def _sanitize(frame: pd.DataFrame, interval: str) -> pd.DataFrame | None:
        """
        Buang candle belum-close, urutkan naik, buang duplikat, validasi OHLC.
        Return None bila datanya secara struktural tidak masuk akal.
        """
        frame = frame.dropna().drop_duplicates(subset="timestamp")
        frame = frame.sort_values("timestamp").reset_index(drop=True)

        if frame.empty:
            return None

        # Sanity check pemetaan kolom. Kalau high bukan yang tertinggi, berarti
        # indeks kolom sumbernya salah — lebih baik tolak daripada hitung
        # indikator dari kolom tertukar.
        body_max = frame[["open", "close"]].max(axis=1)
        body_min = frame[["open", "close"]].min(axis=1)
        tolerance = 1e-9
        if ((frame["high"] + tolerance) < body_max).any():
            return None
        if ((frame["low"] - tolerance) > body_min).any():
            return None
        if (frame[["open", "high", "low", "close"]] <= 0).any().any():
            return None

        # Candle terakhir hampir pasti masih berjalan. Kalau ikut dihitung,
        # EMA dan RSI berubah tiap tick dan sinyal crossover muncul-hilang.
        step_ms = _INTERVAL_SECONDS[interval] * 1000
        now_ms = int(datetime.now(tz=timezone.utc).timestamp() * 1000)
        last_open = int(frame.iloc[-1]["timestamp"])
        if last_open + step_ms > now_ms:
            frame = frame.iloc[:-1].reset_index(drop=True)

        return frame if not frame.empty else None

    # ---------------------- matematika indikator ------------------------- #

    @staticmethod
    def calculate_rsi(series: pd.Series, period: int = RSI_PERIOD) -> pd.Series:
        """RSI Wilder. Menangani pembagian nol secara eksplisit."""
        delta = series.diff()
        gain = delta.clip(lower=0.0)
        loss = (-delta).clip(lower=0.0)

        avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()

        rsi = pd.Series(float("nan"), index=series.index, dtype="float64")

        both_valid = avg_gain.notna() & avg_loss.notna()
        no_loss = both_valid & (avg_loss <= 0)
        no_gain = both_valid & (avg_gain <= 0) & (avg_loss > 0)
        normal = both_valid & (avg_loss > 0) & (avg_gain > 0)

        rsi[no_loss] = 100.0   # tidak ada penurunan sama sekali
        rsi[no_gain] = 0.0     # tidak ada kenaikan sama sekali
        rs = avg_gain[normal] / avg_loss[normal]
        rsi[normal] = 100.0 - (100.0 / (1.0 + rs))

        return rsi

    # ---------------------- API utama ------------------------------------ #

    async def analyze(
        self,
        symbol: str = "BTC/USDT",
        interval: str = "1h",
        market_payload: dict[str, Any] | None = None,
        *,
        allow_stale: bool = False,
    ) -> dict[str, Any]:
        """
        Selalu mengembalikan dict valid dengan field `status`. Tidak pernah None.

        market_payload : keluaran MarketDataService.get_coin_data(). Bila
                         diberikan dan statusnya bukan 'ok', perhitungan
                         DITOLAK sebelum satu request pun dikirim.
        allow_stale    : izinkan lanjut saat market status 'stale'. Default
                         False. Nyalakan hanya kalau kamu sadar konsekuensinya.
        """
        symbol = (symbol or "").strip().upper()
        if not symbol:
            return self._refusal(symbol, IndicatorStatus.UNKNOWN_SYMBOL,
                                 "empty_symbol", "Simbol kosong.")

        # ---- GERBANG 1: status data pasar ------------------------------- #
        gate = self._check_market_gate(symbol, market_payload, allow_stale)
        if gate is not None:
            return gate

        # ---- GERBANG 2: ketersediaan klines ----------------------------- #
        fetched = await self.fetch_klines(symbol, interval)
        if fetched["status"] is not IndicatorStatus.OK:
            err = fetched["error"] or {}
            return self._refusal(
                symbol, IndicatorStatus.UNAVAILABLE,
                err.get("code", "unavailable"),
                "Data candle tidak bisa diambil dari sumber mana pun.",
                interval=interval,
            )

        frame: pd.DataFrame = fetched["frame"]

        # ---- GERBANG 3: kecukupan riwayat ------------------------------- #
        if len(frame) < WARMUP_DISCARD + MIN_CANDLES_REQUIRED:
            return self._refusal(
                symbol, IndicatorStatus.INSUFFICIENT_HISTORY, "too_few_candles",
                f"Hanya {len(frame)} candle tersedia; minimal "
                f"{WARMUP_DISCARD + MIN_CANDLES_REQUIRED} untuk EMA{EMA_SLOW} "
                f"dan RSI{RSI_PERIOD} yang konvergen.",
                interval=interval, source=fetched["source"],
            )

        # ---- Perhitungan ------------------------------------------------ #
        frame = frame.copy()
        frame["ema_fast"] = frame["close"].ewm(span=EMA_FAST, adjust=False).mean()
        frame["ema_slow"] = frame["close"].ewm(span=EMA_SLOW, adjust=False).mean()
        frame["rsi"] = self.calculate_rsi(frame["close"])

        # Buang periode warm-up: nilai di zona ini belum konvergen.
        frame = frame.iloc[WARMUP_DISCARD:].reset_index(drop=True)

        latest = frame.iloc[-1]
        ema_fast = self._finite(latest["ema_fast"])
        ema_slow = self._finite(latest["ema_slow"])
        rsi = self._finite(latest["rsi"])

        # ---- GERBANG 4: hasil harus benar-benar angka -------------------- #
        # Tidak ada substitusi 50.0 di sini. NaN artinya belum bisa dihitung.
        if ema_fast is None or ema_slow is None or rsi is None:
            return self._refusal(
                symbol, IndicatorStatus.INSUFFICIENT_HISTORY, "indicator_nan",
                "Indikator belum konvergen pada data yang tersedia.",
                interval=interval, source=fetched["source"],
            )

        last_ts = int(latest["timestamp"])

        return {
            "symbol": symbol,
            "status": IndicatorStatus.OK.value,
            "interval": interval,
            "source": fetched["source"],
            "price": round(float(latest["close"]), 8),
            f"ema{EMA_FAST}": round(ema_fast, 8),
            f"ema{EMA_SLOW}": round(ema_slow, 8),
            "rsi": round(rsi, 2),
            "trend": "bullish" if ema_fast > ema_slow else "bearish",
            "candles_used": int(len(frame)),
            "last_closed_at": datetime.fromtimestamp(
                last_ts / 1000, tz=timezone.utc
            ).isoformat(),
            "chartData": [
                {
                    "time": int(row["timestamp"] // 1000),
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                }
                for _, row in frame.tail(CHART_TAIL).iterrows()
            ],
            "error": None,
        }

    async def analyze_many(
        self,
        symbols: list[str],
        interval: str = "1h",
        market_payloads: dict[str, dict[str, Any]] | None = None,
        *,
        concurrency: int = 5,
    ) -> dict[str, dict[str, Any]]:
        """Scanner multi-aset dengan batas konkurensi supaya tidak kena 429."""
        semaphore = asyncio.Semaphore(concurrency)
        payloads = market_payloads or {}

        async def one(sym: str) -> tuple[str, dict[str, Any]]:
            async with semaphore:
                return sym, await self.analyze(sym, interval, payloads.get(sym.upper()))

        pairs = await asyncio.gather(*(one(s) for s in symbols))
        return dict(pairs)

    # ---------------------- helper --------------------------------------- #

    @staticmethod
    def _check_market_gate(
        symbol: str,
        market_payload: dict[str, Any] | None,
        allow_stale: bool,
    ) -> dict[str, Any] | None:
        if market_payload is None:
            return None

        status = market_payload.get("status")
        if status == "ok":
            return None
        if status == "stale" and allow_stale:
            return None

        code = (market_payload.get("error") or {}).get("code", status or "unknown")
        return IndicatorEngine._refusal(
            symbol,
            IndicatorStatus.UNKNOWN_SYMBOL if status == "unknown_symbol"
            else IndicatorStatus.BLOCKED_BY_MARKET_STATUS,
            code,
            f"Perhitungan dibatalkan: status data pasar '{status}'.",
        )

    @staticmethod
    def _finite(value: Any) -> float | None:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        return number if math.isfinite(number) else None

    @staticmethod
    def _refusal(
        symbol: str,
        status: IndicatorStatus,
        code: str,
        message: str,
        interval: str = "1h",
        source: str | None = None,
    ) -> dict[str, Any]:
        """Bentuk penolakan. Semua field indikator None — tidak ada angka karangan."""
        return {
            "symbol": symbol,
            "status": status.value,
            "interval": interval,
            "source": source,
            "price": None,
            f"ema{EMA_FAST}": None,
            f"ema{EMA_SLOW}": None,
            "rsi": None,
            "trend": None,
            "candles_used": 0,
            "last_closed_at": None,
            "chartData": [],
            "error": {"code": code, "message": message},
        }

    # ---------------------- jembatan ke layer chat AI -------------------- #

    @staticmethod
    def to_context_line(payload: dict[str, Any]) -> str:
        symbol = payload.get("symbol", "?")
        status = payload.get("status")

        if status != IndicatorStatus.OK.value:
            reason = (payload.get("error") or {}).get("message", "data tidak memadai")
            return (
                f"{symbol}: indikator teknikal TIDAK DIHITUNG — {reason} "
                f"Jangan menyimpulkan tren atau memberi sinyal untuk aset ini."
            )

        return (
            f"{symbol} ({payload['interval']}, {payload['source']}): "
            f"harga {payload['price']:,.4f}, "
            f"EMA{EMA_FAST} {payload[f'ema{EMA_FAST}']:,.4f}, "
            f"EMA{EMA_SLOW} {payload[f'ema{EMA_SLOW}']:,.4f}, "
            f"RSI {payload['rsi']:.2f}, tren {payload['trend']}. "
            f"Candle terakhir ditutup {payload['last_closed_at']}."
        )

    @classmethod
    def to_context_block(cls, payloads: dict[str, dict[str, Any]]) -> str:
        return "\n".join(cls.to_context_line(p) for p in payloads.values())