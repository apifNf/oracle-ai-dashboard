"""
backend/app/workers/whale_trade_worker.py

ORACLE :: WhaleTradeWorker

Aliran on-chain / eksekusi real-time dari WebSocket publik Bybit v5
(`publicTrade.<SYMBOL>` pada pasar linear perpetual — di situlah likuiditas
whale terkonsentrasi). Setiap trade dengan notional >= WHALE_THRESHOLD_USD
didorong ke MarketIntelStore sebagai event "whale execution".

Sumber dipindah dari Binance karena Binance memblokir IP AS (HTTP 451) dan
server Render berlokasi di AS. Bybit tidak geoblock AS. Bentuk event yang
dikirim ke frontend TIDAK berubah.

100% real-time, tanpa API key, tanpa dummy. Pelengkap OnChainWorker
(transfer ETH/ERC-20 on-chain sungguhan lewat JSON-RPC).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import random
from datetime import datetime, timezone
from typing import Any

import websockets

from app.core.config import settings
from app.core.memory import GcPacer

logger = logging.getLogger(__name__)

__all__ = ["WhaleTradeWorker"]

BYBIT_WS = "wss://stream.bybit.com/v5/public/linear"
WS_SUBSCRIBE_CHUNK = 10    # batas arg per pesan subscribe Bybit

# Pasangan likuid utama — cukup untuk aliran whale yang konsisten.
# Format simbol Bybit linear (huruf besar, tanpa pemisah): BTCUSDT.
PAIRS = (
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT",
    "ADAUSDT", "AVAXUSDT", "LINKUSDT", "LTCUSDT", "TRXUSDT", "SUIUSDT",
)

WS_PING_INTERVAL = 20
WS_PING_TIMEOUT = 20
WS_MAX_QUEUE = 64          # batasi antrean frame masuk (anti buffer menumpuk)
WS_MAX_SIZE = 2 ** 18      # 256 KB per frame; aggTrade jauh lebih kecil
BACKOFF_BASE = 1.6
BACKOFF_MAX = 45.0
GC_EVERY_MESSAGES = 4000   # paksa gc.collect() tiap N aggTrade diproses
GC_EVERY_SECONDS = 90.0


class WhaleTradeWorker:
    def __init__(self, store: Any, *, threshold_usd: float | None = None) -> None:
        self._store = store
        # 🚨 WHALE ALERT di >= threshold; masuk aliran di >= stream_min.
        self._threshold = float(threshold_usd or settings.whale_threshold_usd)
        self._stream_min = min(
            self._threshold, float(getattr(settings, "whale_stream_min_usd", 250_000.0))
        )
        self._task: asyncio.Task | None = None
        self._failures = 0
        self._last_event_at: float = 0.0

    async def start(self) -> None:
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._run(), name="whale-trade-worker")
        logger.info(
            "Whale-trade worker dijalankan (%d pasangan, ambang $%.0f).",
            len(PAIRS), self._threshold,
        )

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _run(self) -> None:
        while True:
            try:
                await self._consume()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning(
                    "Whale-trade stream terputus: %s (%s)",
                    type(exc).__name__, str(exc)[:160],
                )
            self._failures += 1
            delay = random.uniform(
                0.5, min(BACKOFF_BASE ** self._failures, BACKOFF_MAX)
            )
            await asyncio.sleep(delay)

    async def _consume(self) -> None:
        pacer = GcPacer(
            every_seconds=GC_EVERY_SECONDS, every_calls=GC_EVERY_MESSAGES, tag="whale-ws"
        )
        async with websockets.connect(
            BYBIT_WS,
            ping_interval=WS_PING_INTERVAL,
            ping_timeout=WS_PING_TIMEOUT,
            close_timeout=10,
            max_size=WS_MAX_SIZE,
            max_queue=WS_MAX_QUEUE,
        ) as socket:
            args = [f"publicTrade.{p}" for p in PAIRS]
            for i in range(0, len(args), WS_SUBSCRIBE_CHUNK):
                await socket.send(
                    json.dumps({"op": "subscribe", "args": args[i : i + WS_SUBSCRIBE_CHUNK]})
                )
            self._failures = 0
            logger.info("Whale-trade stream tersambung (%d aliran).", len(PAIRS))
            async for message in socket:
                try:
                    self._handle(message)
                except Exception:
                    logger.debug("Pesan publicTrade gagal diproses.", exc_info=True)
                finally:
                    # Lepas referensi frame sebelum iterasi berikutnya.
                    del message
                    pacer.tick()

    def _handle(self, message: str | bytes) -> None:
        envelope = json.loads(message)
        if not isinstance(envelope, dict):
            return
        # Bybit `publicTrade.*` mengirim `data` sebagai LIST trade; ack subscribe
        # dan pong tidak punya topik itu.
        topic = str(envelope.get("topic", ""))
        trades = envelope.get("data")
        if not topic.startswith("publicTrade.") or not isinstance(trades, list) or not trades:
            return

        # Binance `@aggTrade` menggabungkan fill dari satu order di harga sama
        # menjadi satu event; Bybit `publicTrade` tidak. Satu pesan Bybit berisi
        # fill dari satu match event (satu taker order), jadi kita jumlahkan
        # per (simbol, sisi) agar notional-nya sebanding dengan event lama.
        buckets: dict[tuple[str, str], dict[str, Any]] = {}
        for t in trades:
            if not isinstance(t, dict):
                continue
            try:
                price = float(t["p"])
                qty = float(t["v"])
            except (KeyError, TypeError, ValueError):
                continue
            symbol = str(t.get("s", ""))
            # S = sisi taker (agresor): "Buy" -> BUY agresif, "Sell" -> SELL.
            side = "SELL" if str(t.get("S", "")).upper() == "SELL" else "BUY"
            b = buckets.setdefault(
                (symbol, side), {"qty": 0.0, "usd": 0.0, "last": t}
            )
            b["qty"] += qty
            b["usd"] += price * qty
            b["last"] = t

        for (symbol, side), b in buckets.items():
            self._emit_trade(symbol, side, b["qty"], b["usd"], b["last"])

    def _emit_trade(
        self, symbol: str, side: str, qty: float, usd: float, last: dict
    ) -> None:
        if usd < self._stream_min:
            return
        important = usd >= self._threshold

        asset = symbol[:-4] if symbol.endswith("USDT") else symbol
        trade_id = last.get("i")
        price = usd / qty if qty else float(last.get("p", 0) or 0)
        ts = last.get("T")
        received = (
            datetime.fromtimestamp(int(ts) / 1000, tz=timezone.utc).isoformat()
            if ts else datetime.now(tz=timezone.utc).isoformat()
        )

        event = {
            "id": f"bybit:{symbol}:{trade_id}",
            "event_type": "EXCHANGE_TRADE",
            "network": "bybit-cex",
            "asset": asset,
            "amount_display": _fmt_qty(qty),
            "amount_usd": round(usd, 2),
            "price": round(price, 8),
            "side": side,
            "from_address": "Whale" if side == "SELL" else "Market",
            "to_address": "Bybit",
            "tx_hash": None,
            "trade_ref": str(trade_id),
            "status": "IMPORTANT" if important else (
                "BULLISH" if side == "BUY" else "BEARISH"
            ),
            "received_at": received,
        }
        if self._store.add_onchain(event):
            self._last_event_at = datetime.now(tz=timezone.utc).timestamp()
            logger.info(
                "WHALE %s %s %s (~$%.0f) @ %.4f",
                side, _fmt_qty(qty), asset, usd, price,
            )


def _fmt_qty(q: float) -> str:
    if q >= 1_000_000:
        return f"{q / 1_000_000:.2f}M"
    if q >= 1_000:
        return f"{q:,.0f}"
    if q >= 1:
        return f"{q:,.2f}"
    return f"{q:.4f}".rstrip("0").rstrip(".")
