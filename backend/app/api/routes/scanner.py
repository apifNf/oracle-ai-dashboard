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

from app.core.memory import GcPacer
from app.indicators.engine import IndicatorEngine

logger = logging.getLogger(__name__)

router = APIRouter()

# --------------------------------------------------------------------------- #
# Konfigurasi
# --------------------------------------------------------------------------- #

# Sumber data: Bybit v5 (spot). Render berlokasi di AS dan Binance memblokir IP
# AS dengan HTTP 451 (geoblock) — WebSocket & REST Binance mati total di sana.
# Bybit tidak melakukan geoblock AS, formatnya bersih, dan simbolnya sama
# (BTCUSDT). Format akhir yang dikirim ke frontend TIDAK berubah.
BYBIT_REST = "https://api.bybit.com/v5"
BYBIT_WS = "wss://stream.bybit.com/v5/public/spot"
WS_SUBSCRIBE_CHUNK = 10             # Bybit membatasi arg per pesan subscribe

# Hanya simbol. Tidak ada harga patokan di sini — begitu ada angka hardcoded,
# selalu ada godaan untuk memakainya saat jaringan gagal.
#
# CATATAN: MATIC, RNDR, dan FTM sudah dihapus. Ketiganya didelisting
# (MATIC -> POL Sep 2024, RNDR -> RENDER Jul 2024, FTM -> S/Sonic). Simbol
# yang tidak ada di Bybit spot dibuang otomatis oleh _validate_symbols().
SCANNER_PAIRS: tuple[str, ...] = (
    "BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT",
    "ADA/USDT", "DOGE/USDT", "AVAX/USDT", "LINK/USDT", "DOT/USDT",
    "POL/USDT", "UNI/USDT", "LTC/USDT", "BCH/USDT", "ETC/USDT",
    "FIL/USDT", "ICP/USDT", "VET/USDT", "NEAR/USDT", "OP/USDT",
    "ARB/USDT", "INJ/USDT", "RENDER/USDT", "ATOM/USDT", "IMX/USDT",
    "STX/USDT", "TRX/USDT", "APT/USDT", "S/USDT", "SUI/USDT",
)
# CATATAN: TAO/USDT (Bittensor) diganti APT/USDT — Bybit tidak melistkan TAO di
# pasar spot ("Not supported symbols"), hanya perpetual. APT likuid di spot.

TICKER_STALE_SECONDS = 30           # di atas ini, harga dianggap basi
INDICATOR_REFRESH_SECONDS = 300     # klines 1h — tidak ada gunanya lebih cepat
INDICATOR_WARMUP_RETRY_SECONDS = 15 # saat belum ada aset OK (mis. baru boot)
INDICATOR_CONCURRENCY = 4
BROADCAST_INTERVAL_SECONDS = 5

WS_BACKOFF_BASE = 1.5
WS_BACKOFF_MAX = 60.0
WS_PING_INTERVAL = 20
WS_PING_TIMEOUT = 20
WS_MAX_QUEUE = 96           # batasi antrean frame ticker masuk
WS_MAX_SIZE = 2 ** 18       # 256 KB per frame (ticker jauh lebih kecil)
GC_EVERY_TICKS = 6000       # gc.collect() tiap N pesan ticker
GC_EVERY_SECONDS = 90.0

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


class BybitStreamManager:
    """
    Satu koneksi WebSocket publik Bybit v5 untuk semua pasangan (topik
    `tickers.<SYMBOL>`).

    Bursa memutus koneksi secara berkala sebagai perilaku normal, bukan error.
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
        self._task = asyncio.create_task(self._run(), name="bybit-stream")
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
        Buang simbol yang tidak ada di Bybit spot SEBELUM membuka stream.

        Ini bukan kehati-hatian berlebihan: nama topik yang tidak valid membuat
        Bybit membalas error subscribe, dan simbol mati mengotori snapshot REST.
        Endpoint /market/tickers mengembalikan SELURUH pasangan spot dalam satu
        respons (tanpa paginasi), jadi dipakai sekaligus untuk validasi.
        """
        assert self._client is not None
        try:
            response = await self._client.get(
                f"{BYBIT_REST}/market/tickers", params={"category": "spot"}
            )
            response.raise_for_status()
            payload = response.json()
            rows = (payload.get("result") or {}).get("list") or []
        except Exception:
            logger.warning("Daftar simbol Bybit tidak terbaca; melanjutkan tanpa validasi.")
            return

        tradable = {str(item.get("symbol", "")) for item in rows if item.get("symbol")}
        if len(tradable) < 50:
            # Respons mencurigakan (mungkin error terselubung) — jangan sampai
            # salah membuang seluruh daftar aset.
            logger.warning(
                "Daftar simbol Bybit hanya %d entri; lewati validasi kali ini.",
                len(tradable),
            )
            return

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
                "Simbol tidak ada di Bybit spot dan dikeluarkan dari "
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

        try:
            response = await self._client.get(
                f"{BYBIT_REST}/market/tickers", params={"category": "spot"}
            )
            response.raise_for_status()
            payload = response.json()
            rows = (payload.get("result") or {}).get("list") or []
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
            # Bybit: price24hPcnt berupa rasio (0.0196), bukan persen.
            pcnt = _to_float(row.get("price24hPcnt"))
            ticker.change_24h = pcnt * 100 if pcnt is not None else None
            ticker.high_24h = _to_float(row.get("highPrice24h"))
            ticker.low_24h = _to_float(row.get("lowPrice24h"))
            # turnover24h = volume dalam mata uang quote (USDT), setara quoteVolume.
            ticker.quote_volume = _to_float(row.get("turnover24h"))
            ticker.updated_at = now
            count += 1

        logger.info("Snapshot REST: %d/%d pasangan terisi.", count, len(self.tickers))
        return count

    # ---------------------- loop WebSocket ------------------------------- #

    def _subscribe_args(self) -> list[str]:
        return [f"tickers.{t.symbol}" for t in self.tickers.values()]

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
        pacer = GcPacer(
            every_seconds=GC_EVERY_SECONDS, every_calls=GC_EVERY_TICKS, tag="scanner-ws"
        )
        async with websockets.connect(
            BYBIT_WS,
            ping_interval=WS_PING_INTERVAL,
            ping_timeout=WS_PING_TIMEOUT,
            close_timeout=10,
            max_size=WS_MAX_SIZE,
            max_queue=WS_MAX_QUEUE,
        ) as socket:
            # Bybit tidak memakai combined-URL: topik di-subscribe lewat pesan
            # JSON setelah handshake, dipecah agar tidak melewati batas arg.
            args = self._subscribe_args()
            for i in range(0, len(args), WS_SUBSCRIBE_CHUNK):
                await socket.send(
                    json.dumps({"op": "subscribe", "args": args[i : i + WS_SUBSCRIBE_CHUNK]})
                )

            self._connected = True
            self._consecutive_failures = 0
            self._last_connect_at = time.time()
            logger.info("Bybit ticker stream tersambung (%d aliran).", len(self.tickers))

            async for message in socket:
                try:
                    self._handle(message)
                except Exception:
                    # Satu pesan rusak tidak boleh menjatuhkan koneksi.
                    logger.debug("Pesan stream gagal diproses.", exc_info=True)
                finally:
                    del message
                    pacer.tick()

    def _handle(self, message: str | bytes) -> None:
        envelope = json.loads(message)
        if not isinstance(envelope, dict):
            return

        # Abaikan ack subscribe / pong: hanya pesan topik `tickers.*` yang punya
        # payload harga.
        topic = str(envelope.get("topic", ""))
        data = envelope.get("data")
        if not topic.startswith("tickers.") or not isinstance(data, dict):
            return

        pair = self._symbol_index.get(str(data.get("symbol", "")).lower())
        if pair is None:
            return

        ticker = self.tickers[pair]
        price = _to_float(data.get("lastPrice"))
        if price is None or price <= 0:
            return

        ticker.price = price
        # Bybit spot mengirim snapshot penuh tiap pesan; tetap jaga nilai lama
        # kalau suatu field absen.
        pcnt = _to_float(data.get("price24hPcnt"))
        if pcnt is not None:
            ticker.change_24h = pcnt * 100
        high = _to_float(data.get("highPrice24h"))
        if high is not None:
            ticker.high_24h = high
        low = _to_float(data.get("lowPrice24h"))
        if low is not None:
            ticker.low_24h = low
        vol = _to_float(data.get("turnover24h"))
        if vol is not None:
            ticker.quote_volume = vol
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

    async def start(self, stream: BybitStreamManager) -> None:
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._loop(stream), name="indicator-refresh")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _loop(self, stream: BybitStreamManager) -> None:
        while True:
            ok_count = 0
            try:
                ok_count = await self.refresh(stream)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Refresh indikator gagal; mencoba siklus berikutnya.")
            # Setelah boot, ticker butuh beberapa detik untuk terisi lewat REST
            # snapshot + stream. Kalau belum ada satu pun aset OK, jangan tunggu
            # 5 menit penuh — coba lagi cepat sampai konvergen.
            delay = (
                INDICATOR_REFRESH_SECONDS if ok_count > 0 else INDICATOR_WARMUP_RETRY_SECONDS
            )
            await asyncio.sleep(delay)

    async def refresh(self, stream: BybitStreamManager) -> int:
        pairs = list(stream.tickers.keys())
        if not pairs:
            return 0

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

        # analyze_many membangun 30 DataFrame pandas 300-baris; reclaim segera
        # supaya RSS proses tidak melonjak tiap siklus refresh.
        del payloads
        import gc

        gc.collect()
        return ok_count

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
        self.stream = BybitStreamManager()
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
        # Beri stream kesempatan mengisi harga (REST snapshot + tick pertama)
        # sebelum refresh awal — kalau tidak, gerbang status pasar menolak
        # SEMUA aset dan kartu scanner tampil "Dihentikan" sampai siklus 5 menit
        # berikutnya. Tunggu maksimal ~8 detik sampai mayoritas ticker punya harga.
        for _ in range(16):
            await asyncio.sleep(0.5)
            priced = sum(1 for t in self.stream.tickers.values() if t.price is not None)
            if self.stream.tickers and priced >= len(self.stream.tickers) * 0.6:
                break
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
        pacer = GcPacer(every_seconds=120.0, every_calls=24, tag="scanner-hub")
        while True:
            try:
                self._snapshot = self.build_snapshot()
                await self._cache_snapshot()
                await self._broadcast()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Siklus broadcast gagal.")
            pacer.tick()
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


@router.get("/scanner/detail/{coin}")
async def scanner_detail(coin: str, request: Request, interval: str = "1h") -> dict[str, Any]:
    """
    Detail per aset + timeframe untuk panel chart di kartu scanner.

    Frontend (scanner/page.tsx) memanggil GET /api/v1/scanner/detail/{coin}?interval=…
    tapi route ini sebelumnya tidak ada — panel candle selalu 404. Perhitungan
    memakai IndicatorEngine milik hub (klien httpx yang sama, tidak membuka
    koneksi baru per request), lalu ditempeli live_price dari ticker stream.
    """
    hub = _hub(request)
    symbol = coin.strip().upper()
    pair = symbol if "/" in symbol else f"{symbol}/USDT"

    valid_intervals = {"15m", "1h", "4h", "1d"}
    if interval not in valid_intervals:
        interval = "1h"

    payload = await hub.engine.analyze(pair, interval=interval)

    ticker = hub.stream.tickers.get(pair)
    payload["live_price"] = ticker.price if ticker is not None else None
    return payload


@router.get("/scanner/orderbook/{coin}")
async def scanner_orderbook(
    coin: str,
    request: Request,
    market_type: str = "spot",
    depth: int = 20,
) -> dict[str, Any]:
    """
    Order book Level 2 (bids & asks) untuk SATU aset — dipanggil on-demand oleh
    modal eksekusi saat dibuka, lalu berhenti begitu modal ditutup.

    Sengaja REST, bukan langganan WebSocket global: order book berubah tiap
    milidetik dan melanggan 30 aset di background adalah jalan tercepat menuju
    OOM. Di sini tidak ada state yang tumbuh — hanya cache TTL ~1 detik dengan
    batas jumlah simbol (lihat OrderBookService).
    """
    from app.services.orderbook_service import OrderBookError

    service = getattr(request.app.state, "orderbook_service", None)
    if service is None:
        raise HTTPException(
            status_code=503, detail="OrderBookService belum diinisialisasi."
        )

    try:
        return await service.fetch(coin, market_type=market_type, depth=depth)
    except OrderBookError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


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