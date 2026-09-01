from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import random
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable

import httpx
import websockets
from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect, HTTPException

from app.indicators.engine import IndicatorEngine

logger = logging.getLogger(__name__)

router = APIRouter()

# --------------------------------------------------------------------------- #
# Konfigurasi
# --------------------------------------------------------------------------- #

BINANCE_REST = "https://api.binance.com/api/v3"
BINANCE_WS = "wss://stream.binance.com:9443/stream"

# Hanya simbol. Tidak ada harga patokan di sini — begitu ada angka hardcoded,
# selalu ada godaan untuk memakainya saat jaringan gagal.
#
# CATATAN: MATIC, RNDR, dan FTM sudah dihapus. Ketiganya didelisting Binance
# (MATIC -> POL Sep 2024, RNDR -> RENDER Jul 2024, FTM -> S/Sonic). Satu simbol
# mati membuat /ticker/24hr?symbols=[...] mengembalikan 400 untuk SELURUH batch.
SCANNER_PAIRS: tuple[str, ...] = (
    "BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT",
    "ADA/USDT", "DOGE/USDT", "AVAX/USDT", "LINK/USDT", "DOT/USDT",
    "POL/USDT", "UNI/USDT", "LTC/USDT", "BCH/USDT", "ETC/USDT",
    "FIL/USDT", "ICP/USDT", "VET/USDT", "NEAR/USDT", "OP/USDT",
    "ARB/USDT", "INJ/USDT", "RENDER/USDT", "ATOM/USDT", "IMX/USDT",
    "STX/USDT", "KAS/USDT", "TAO/USDT", "S/USDT", "SUI/USDT",
)

TICKER_STALE_SECONDS = 30           # di atas ini, harga dianggap basi
INDICATOR_REFRESH_SECONDS = 300     # klines 1h — tidak ada gunanya lebih cepat
INDICATOR_CONCURRENCY = 4
BROADCAST_INTERVAL_SECONDS = 5

WS_BACKOFF_BASE = 1.5
WS_BACKOFF_MAX = 60.0
WS_PING_INTERVAL = 20
WS_PING_TIMEOUT = 20

REDIS_SNAPSHOT_KEY = "oracle:scanner:snapshot"
REDIS_SNAPSHOT_TTL = 120

RULE_SET_VERSION = "ema_cross_rsi_v1"


# --------------------------------------------------------------------------- #
# State harga
# --------------------------------------------------------------------------- #


@dataclass
class Ticker:
    symbol: str          # BTCUSDT
    pair: str            # BTC/USDT
    price: float | None = None
    change_24h: float | None = None
    high_24h: float | None = None
    low_24h: float | None = None
    quote_volume: float | None = None
    updated_at: float = 0.0

    @property
    def age(self) -> float:
        return time.time() - self.updated_at if self.updated_at else float("inf")

    def market_payload(self) -> dict[str, Any]:
        """
        Bentuk yang sama dengan MarketDataService, supaya bisa dipakai sebagai
        gerbang oleh IndicatorEngine.analyze().
        """
        if self.price is None or self.updated_at == 0.0:
            return {
                "symbol": self.pair, "status": "unavailable", "price": None,
                "change_24h": None, "as_of": None, "age_seconds": None,
                "error": {"code": "no_ticker", "message": "Belum ada data ticker."},
            }

        age = self.age
        status = "ok" if age <= TICKER_STALE_SECONDS else "stale"
        return {
            "symbol": self.pair,
            "status": status,
            "price": self.price,
            "change_24h": self.change_24h,
            "as_of": datetime.fromtimestamp(self.updated_at, tz=timezone.utc).isoformat(),
            "age_seconds": int(age),
            "error": None if status == "ok" else {
                "code": "stale_ticker",
                "message": f"Harga terakhir {int(age)} detik lalu.",
            },
        }


# --------------------------------------------------------------------------- #
# Stream manager
# --------------------------------------------------------------------------- #


class BinanceStreamManager:
    """
    Satu koneksi combined stream untuk semua pasangan.

    Binance memutus koneksi setiap 24 jam sebagai perilaku normal, bukan error.
    Reconnect wajib, dan setelah reconnect harga lama sudah basi — karena itu
    snapshot REST dijalankan ulang di setiap reconnect, bukan hanya saat start.
    """

    def __init__(self, pairs: Iterable[str] = SCANNER_PAIRS) -> None:
        self.tickers: dict[str, Ticker] = {
            pair: Ticker(symbol=pair.replace("/", ""), pair=pair) for pair in pairs
        }
        self._symbol_index: dict[str, str] = {
            t.symbol.lower(): pair for pair, t in self.tickers.items()
        }
        self._task: asyncio.Task | None = None
        self._client: httpx.AsyncClient | None = None
        self._connected = False
        self._last_connect_at: float = 0.0
        self._consecutive_failures = 0

    @property
    def connected(self) -> bool:
        return self._connected

    # ---------------------- daur hidup ----------------------------------- #

    async def start(self) -> None:
        if self._task is not None:
            return
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0),
            headers={"User-Agent": "ORACLE-Dashboard/1.0 (+scanner)"},
        )
        await self._validate_symbols()
        self._task = asyncio.create_task(self._run(), name="binance-stream")
        logger.info("Stream manager dijalankan untuk %d pasangan.", len(self.tickers))

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        if self._client is not None:
            await self._client.aclose()
            self._client = None
        self._connected = False

    # ---------------------- validasi simbol ------------------------------ #

    async def _validate_symbols(self) -> None:
        """
        Buang simbol yang tidak diperdagangkan SEBELUM membuka stream.

        Ini bukan kehati-hatian berlebihan: satu simbol mati membuat request
        batch REST gagal total, dan nama stream tidak valid bisa membuat
        Binance menolak koneksi WebSocket.
        """
        assert self._client is not None
        try:
            response = await self._client.get(f"{BINANCE_REST}/exchangeInfo")
            response.raise_for_status()
            payload = response.json()
        except Exception:
            logger.warning("exchangeInfo tidak terbaca; melanjutkan tanpa validasi.")
            return

        tradable = {
            item["symbol"]
            for item in payload.get("symbols", [])
            if item.get("status") == "TRADING"
        }

        removed = [
            pair for pair, ticker in self.tickers.items()
            if ticker.symbol not in tradable
        ]
        for pair in removed:
            self.tickers.pop(pair, None)

        if removed:
            # Log level error, bukan warning: daftar aset yang basi adalah bug
            # konfigurasi yang perlu diperbaiki manusia.
            logger.error(
                "Simbol tidak diperdagangkan di Binance dan dikeluarkan dari "
                "scanner: %s. Perbarui SCANNER_PAIRS.", ", ".join(sorted(removed))
            )

        self._symbol_index = {
            t.symbol.lower(): pair for pair, t in self.tickers.items()
        }

    # ---------------------- snapshot REST -------------------------------- #

    async def snapshot(self) -> int:
        """
        Satu panggilan REST untuk semua pasangan. Dipakai saat startup dan
        setiap kali WebSocket tersambung ulang.
        """
        if self._client is None or not self.tickers:
            return 0

        symbols = [t.symbol for t in self.tickers.values()]
        symbols_param = json.dumps(symbols, separators=(",", ":"))

        try:
            response = await self._client.get(
                f"{BINANCE_REST}/ticker/24hr", params={"symbols": symbols_param}
            )
            response.raise_for_status()
            rows = response.json()
        except Exception as exc:
            logger.warning("Snapshot REST gagal: %s", type(exc).__name__)
            return 0

        now = time.time()
        count = 0
        for row in rows if isinstance(rows, list) else []:
            pair = self._symbol_index.get(str(row.get("symbol", "")).lower())
            if pair is None:
                continue
            ticker = self.tickers[pair]
            ticker.price = _to_float(row.get("lastPrice"))
            ticker.change_24h = _to_float(row.get("priceChangePercent"))
            ticker.high_24h = _to_float(row.get("highPrice"))
            ticker.low_24h = _to_float(row.get("lowPrice"))
            ticker.quote_volume = _to_float(row.get("quoteVolume"))
            ticker.updated_at = now
            count += 1

        logger.info("Snapshot REST: %d/%d pasangan terisi.", count, len(self.tickers))
        return count

    # ---------------------- loop WebSocket ------------------------------- #

    def _stream_url(self) -> str:
        streams = "/".join(f"{t.symbol.lower()}@ticker" for t in self.tickers.values())
        return f"{BINANCE_WS}?streams={streams}"

    async def _run(self) -> None:
        while True:
            try:
                await self.snapshot()
                await self._consume()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning(
                    "Koneksi stream terputus: %s (%s)",
                    type(exc).__name__, str(exc)[:200],
                )
            finally:
                self._connected = False

            delay = self._backoff()
            logger.info("Menyambung ulang dalam %.1f detik.", delay)
            await asyncio.sleep(delay)

    async def _consume(self) -> None:
        url = self._stream_url()
        async with websockets.connect(
            url,
            ping_interval=WS_PING_INTERVAL,
            ping_timeout=WS_PING_TIMEOUT,
            close_timeout=10,
            max_size=2 ** 20,
        ) as socket:
            self._connected = True
            self._consecutive_failures = 0
            self._last_connect_at = time.time()
            logger.info("Combined stream tersambung (%d aliran).", len(self.tickers))

            async for message in socket:
                try:
                    self._handle(message)
                except Exception:
                    # Satu pesan rusak tidak boleh menjatuhkan koneksi.
                    logger.debug("Pesan stream gagal diproses.", exc_info=True)

    def _handle(self, message: str | bytes) -> None:
        envelope = json.loads(message)
        data = envelope.get("data") if isinstance(envelope, dict) else None
        if not isinstance(data, dict):
            return

        pair = self._symbol_index.get(str(data.get("s", "")).lower())
        if pair is None:
            return

        ticker = self.tickers[pair]
        price = _to_float(data.get("c"))
        if price is None or price <= 0:
            return

        ticker.price = price
        ticker.change_24h = _to_float(data.get("P"))
        ticker.high_24h = _to_float(data.get("h"))
        ticker.low_24h = _to_float(data.get("l"))
        ticker.quote_volume = _to_float(data.get("q"))
        # Pakai waktu lokal, bukan event time dari bursa: yang kita ukur adalah
        # umur data di sisi kita, dan jam server bisa selisih.
        ticker.updated_at = time.time()

    def _backoff(self) -> float:
        """Exponential backoff dengan jitter penuh, dibatasi WS_BACKOFF_MAX."""
        self._consecutive_failures += 1
        ceiling = min(WS_BACKOFF_BASE ** self._consecutive_failures, WS_BACKOFF_MAX)
        return random.uniform(0.5, ceiling)

    def health(self) -> dict[str, Any]:
        fresh = sum(1 for t in self.tickers.values() if t.age <= TICKER_STALE_SECONDS)
        return {
            "connected": self._connected,
            "pairs_tracked": len(self.tickers),
            "pairs_fresh": fresh,
            "consecutive_failures": self._consecutive_failures,
            "connected_since": (
                datetime.fromtimestamp(self._last_connect_at, tz=timezone.utc).isoformat()
                if self._last_connect_at else None
            ),
        }


# --------------------------------------------------------------------------- #
# Cache indikator
# --------------------------------------------------------------------------- #


class IndicatorCache:
    """
    Indikator dihitung dari klines yang SUDAH CLOSE, bukan dari tick ticker.

    Menghitung RSI dari harga tick akan menghasilkan nilai yang berbeda dari
    chart mana pun dan berubah setiap detik. Interval refresh disamakan dengan
    interval candle — lebih cepat dari itu hanya membakar rate limit.
    """

    def __init__(self, engine: IndicatorEngine) -> None:
        self._engine = engine
        self._data: dict[str, dict[str, Any]] = {}
        self._refreshed_at: float = 0.0
        self._task: asyncio.Task | None = None

    async def start(self, stream: BinanceStreamManager) -> None:
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._loop(stream), name="indicator-refresh")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _loop(self, stream: BinanceStreamManager) -> None:
        while True:
            try:
                await self.refresh(stream)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Refresh indikator gagal; mencoba siklus berikutnya.")
            await asyncio.sleep(INDICATOR_REFRESH_SECONDS)

    async def refresh(self, stream: BinanceStreamManager) -> None:
        pairs = list(stream.tickers.keys())
        if not pairs:
            return

        # Gerbang dari harga live diteruskan ke engine. Kunci dict-nya adalah
        # pasangan penuh ("BTC/USDT"), sama persis dengan yang diminta engine —
        # kalau formatnya berbeda, gerbangnya diam-diam tidak pernah aktif.
        payloads = {pair: stream.tickers[pair].market_payload() for pair in pairs}

        results = await self._engine.analyze_many(
            pairs, interval="1h", market_payloads=payloads,
            concurrency=INDICATOR_CONCURRENCY,
        )

        self._data = results
        self._refreshed_at = time.time()

        ok_count = sum(1 for r in results.values() if r.get("status") == "ok")
        logger.info("Indikator diperbarui: %d/%d aset ok.", ok_count, len(results))

    def get(self, pair: str) -> dict[str, Any] | None:
        return self._data.get(pair)

    @property
    def age(self) -> float:
        return time.time() - self._refreshed_at if self._refreshed_at else float("inf")


# --------------------------------------------------------------------------- #
# Sinyal
# --------------------------------------------------------------------------- #


def build_signal(pair: str, ticker: Ticker, indicators: dict[str, Any] | None) -> dict[str, Any]:
    """
    Gabungkan harga live dan indikator menjadi satu baris scanner.

    Tidak ada persentase keyakinan. Yang dilaporkan adalah kriteria mana yang
    terpenuhi, sehingga user bisa memeriksa alasannya sendiri. Angka seperti
    "keyakinan 80%" menyiratkan kalibrasi probabilistik yang tidak kita miliki.
    """
    market = ticker.market_payload()
    base = {
        "coin": pair.split("/")[0],
        "pair": pair,
        "price": market["price"],
        "change_24h": market["change_24h"],
        "price_status": market["status"],
        "price_age_seconds": market["age_seconds"],
        "rule_set": RULE_SET_VERSION,
    }

    if market["status"] not in ("ok", "stale"):
        return {
            **base, "status": "unavailable", "signal": None, "trend": None,
            "rsi": None, "ema20": None, "ema50": None,
            "criteria_met": [], "criteria_total": 3,
            "error": market["error"],
        }

    if indicators is None:
        return {
            **base, "status": "pending", "signal": None, "trend": None,
            "rsi": None, "ema20": None, "ema50": None,
            "criteria_met": [], "criteria_total": 3,
            "error": {"code": "indicators_pending", "message": "Indikator belum dihitung."},
        }

    if indicators.get("status") != "ok":
        return {
            **base, "status": indicators.get("status", "unavailable"),
            "signal": None, "trend": None, "rsi": None, "ema20": None, "ema50": None,
            "criteria_met": [], "criteria_total": 3,
            "error": indicators.get("error"),
        }

    rsi = indicators.get("rsi")
    ema20 = indicators.get("ema20")
    ema50 = indicators.get("ema50")
    trend = indicators.get("trend")

    # Kalau salah satu None, jangan diteruskan ke perbandingan — itu TypeError,
    # dan menggantinya dengan default (rsi=50) adalah mengarang pembacaan.
    if rsi is None or ema20 is None or ema50 is None or trend is None:
        return {
            **base, "status": "insufficient_history", "signal": None, "trend": None,
            "rsi": None, "ema20": None, "ema50": None,
            "criteria_met": [], "criteria_total": 3,
            "error": {"code": "indicator_incomplete", "message": "Indikator tidak lengkap."},
        }

    criteria: list[str] = []
    signal = "WAIT"

    if trend == "bullish":
        criteria.append("ema20_above_ema50")
        if rsi < 70:
            criteria.append("rsi_below_overbought")
            signal = "LONG"
        if rsi > 50:
            criteria.append("rsi_above_midline")
    elif trend == "bearish":
        criteria.append("ema20_below_ema50")
        if rsi > 30:
            criteria.append("rsi_above_oversold")
            signal = "SHORT"
        if rsi < 50:
            criteria.append("rsi_below_midline")

    return {
        **base,
        "status": "ok" if market["status"] == "ok" else "stale",
        "signal": signal,
        "trend": trend.capitalize(),
        "rsi": rsi,
        "ema20": ema20,
        "ema50": ema50,
        "indicator_interval": indicators.get("interval"),
        "indicator_source": indicators.get("source"),
        "last_closed_at": indicators.get("last_closed_at"),
        "criteria_met": criteria,
        "criteria_total": 3,
        "error": None,
    }


# --------------------------------------------------------------------------- #
# Hub
# --------------------------------------------------------------------------- #


class ScannerHub:
    """
    Satu perhitungan, banyak klien.

    Versi lama menjalankan get_market_data() di dalam setiap handler WebSocket,
    jadi 10 klien berarti 10x beban dan 10x konsumsi rate limit.
    """

    def __init__(self, redis_client: Any | None = None) -> None:
        self.stream = BinanceStreamManager()
        self.engine = IndicatorEngine()
        self.indicators = IndicatorCache(self.engine)
        self._redis = redis_client
        self._clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None
        self._snapshot: dict[str, Any] = {"status": "starting", "signals": []}

    async def start(self) -> None:
        await self.stream.start()
        await self.indicators.start(self.stream)
        # Hitung indikator sekali di awal agar klien pertama tidak melihat
        # seluruh daftar berstatus "pending" selama lima menit.
        with contextlib.suppress(Exception):
            await self.indicators.refresh(self.stream)
        self._task = asyncio.create_task(self._broadcast_loop(), name="scanner-hub")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        await self.indicators.stop()
        await self.stream.stop()
        await self.engine.aclose()

    # ---------------------- snapshot ------------------------------------- #

    def build_snapshot(self) -> dict[str, Any]:
        signals = [
            build_signal(pair, ticker, self.indicators.get(pair))
            for pair, ticker in self.stream.tickers.items()
        ]

        # Urutan: aset yang datanya sehat dulu, lalu berdasarkan jumlah kriteria
        # terpenuhi. Bukan berdasarkan skor keyakinan karangan.
        rank = {"ok": 0, "stale": 1, "pending": 2}
        signals.sort(
            key=lambda s: (
                rank.get(s["status"], 3),
                -len(s["criteria_met"]),
                s["coin"],
            )
        )

        ok_count = sum(1 for s in signals if s["status"] == "ok")
        return {
            "status": "ok" if ok_count else "degraded",
            "generated_at": datetime.now(tz=timezone.utc).isoformat(),
            "stream": self.stream.health(),
            "indicators_age_seconds": (
                int(self.indicators.age) if self.indicators.age != float("inf") else None
            ),
            "counts": {
                "total": len(signals),
                "ok": ok_count,
                "degraded": len(signals) - ok_count,
            },
            "disclaimer": (
                "Sinyal dihasilkan aturan teknikal deterministik "
                f"({RULE_SET_VERSION}). Bukan prediksi, bukan nasihat keuangan, "
                "dan tidak disertai probabilitas terkalibrasi."
            ),
            "signals": signals,
        }

    async def _broadcast_loop(self) -> None:
        while True:
            try:
                self._snapshot = self.build_snapshot()
                await self._cache_snapshot()
                await self._broadcast()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Siklus broadcast gagal.")
            await asyncio.sleep(BROADCAST_INTERVAL_SECONDS)

    async def _cache_snapshot(self) -> None:
        if self._redis is None:
            return
        try:
            await self._redis.set(
                REDIS_SNAPSHOT_KEY,
                json.dumps(self._snapshot, default=str),
                ex=REDIS_SNAPSHOT_TTL,
            )
        except Exception:
            logger.debug("Cache snapshot gagal (tidak fatal).")

    # ---------------------- klien ---------------------------------------- #

    async def register(self, socket: WebSocket) -> None:
        async with self._lock:
            self._clients.add(socket)
        with contextlib.suppress(Exception):
            await socket.send_json(self._snapshot)

    async def unregister(self, socket: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(socket)

    async def _broadcast(self) -> None:
        async with self._lock:
            targets = list(self._clients)
        if not targets:
            return

        payload = self._snapshot
        dead: list[WebSocket] = []

        for socket in targets:
            try:
                await socket.send_json(payload)
            except Exception:
                dead.append(socket)

        if dead:
            async with self._lock:
                for socket in dead:
                    self._clients.discard(socket)

    @property
    def snapshot(self) -> dict[str, Any]:
        return self._snapshot


# --------------------------------------------------------------------------- #
# Route
# --------------------------------------------------------------------------- #


def _hub(request_or_ws: Request | WebSocket) -> ScannerHub:
    hub = getattr(request_or_ws.app.state, "scanner_hub", None)
    if hub is None:
        raise RuntimeError(
            "scanner_hub belum diinisialisasi. Panggil ScannerHub().start() "
            "di lifespan aplikasi."
        )
    return hub


@router.get("/scanner/signals")
async def scan_signals(request: Request) -> dict[str, Any]:
    """Snapshot terakhir. Tidak memicu perhitungan baru — cukup baca hasil hub."""
    return _hub(request).snapshot


@router.get("/scanner/health")
async def scanner_health(request: Request) -> dict[str, Any]:
    hub = _hub(request)
    return {
        "stream": hub.stream.health(),
        "indicators_age_seconds": (
            int(hub.indicators.age) if hub.indicators.age != float("inf") else None
        ),
        "clients": len(hub._clients),
    }


@router.websocket("/ws/scanner")
async def websocket_scanner(websocket: WebSocket) -> None:
    """
    Klien hanya mendengarkan. Perhitungan dilakukan sekali di hub dan hasilnya
    dikirim ke semua klien — jumlah klien tidak menambah beban ke Binance.
    """
    await websocket.accept()

    try:
        hub = _hub(websocket)
    except RuntimeError as exc:
        await websocket.send_json({"status": "error", "error": str(exc), "signals": []})
        await websocket.close(code=1011)
        return

    await hub.register(websocket)
    try:
        while True:
            # Menjaga koneksi hidup dan mendeteksi disconnect. Pesan masuk
            # diabaikan; kanal ini satu arah.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.debug("Klien scanner terputus tidak normal.", exc_info=True)
    finally:
        await hub.unregister(websocket)


# --------------------------------------------------------------------------- #
# Util
# --------------------------------------------------------------------------- #


def _to_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and abs(number) != float("inf") else None