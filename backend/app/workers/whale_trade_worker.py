"""
backend/app/workers/whale_trade_worker.py

ORACLE :: WhaleTradeWorker

Aliran on-chain / eksekusi real-time dari WebSocket publik Binance
(`<symbol>@aggTrade`). Setiap agg-trade dengan notional >= WHALE_THRESHOLD_USD
didorong ke MarketIntelStore sebagai event "whale execution".

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

logger = logging.getLogger(__name__)

__all__ = ["WhaleTradeWorker"]

BINANCE_WS = "wss://stream.binance.com:9443/stream"

# Pasangan likuid utama — cukup untuk aliran whale yang konsisten.
PAIRS = (
    "btcusdt", "ethusdt", "solusdt", "bnbusdt", "xrpusdt", "dogeusdt",
    "adausdt", "avaxusdt", "linkusdt", "ltcusdt", "trxusdt", "suiusdt",
)

WS_PING_INTERVAL = 20
WS_PING_TIMEOUT = 20
BACKOFF_BASE = 1.6
BACKOFF_MAX = 45.0


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

    def _url(self) -> str:
        streams = "/".join(f"{p}@aggTrade" for p in PAIRS)
        return f"{BINANCE_WS}?streams={streams}"

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
        async with websockets.connect(
            self._url(),
            ping_interval=WS_PING_INTERVAL,
            ping_timeout=WS_PING_TIMEOUT,
            close_timeout=10,
            max_size=2 ** 20,
        ) as socket:
            self._failures = 0
            logger.info("Whale-trade stream tersambung (%d aliran).", len(PAIRS))
            async for message in socket:
                try:
                    self._handle(message)
                except Exception:
                    logger.debug("Pesan aggTrade gagal diproses.", exc_info=True)

    def _handle(self, message: str | bytes) -> None:
        envelope = json.loads(message)
        data = envelope.get("data") if isinstance(envelope, dict) else None
        if not isinstance(data, dict):
            return

        try:
            price = float(data["p"])
            qty = float(data["q"])
        except (KeyError, TypeError, ValueError):
            return
        usd = price * qty
        if usd < self._stream_min:
            return
        important = usd >= self._threshold

        symbol = str(data.get("s", ""))          # BTCUSDT
        asset = symbol[:-4] if symbol.endswith("USDT") else symbol
        agg_id = data.get("a")
        # m = buyer is maker -> taker menjual (SELL agresif); else BUY agresif.
        side = "SELL" if data.get("m") else "BUY"
        ts = data.get("T")
        received = (
            datetime.fromtimestamp(int(ts) / 1000, tz=timezone.utc).isoformat()
            if ts else datetime.now(tz=timezone.utc).isoformat()
        )

        event = {
            "id": f"binance:{symbol}:{agg_id}",
            "event_type": "EXCHANGE_TRADE",
            "network": "binance-cex",
            "asset": asset,
            "amount_display": _fmt_qty(qty),
            "amount_usd": round(usd, 2),
            "price": price,
            "side": side,
            "from_address": "Whale" if side == "SELL" else "Market",
            "to_address": "Binance",
            "tx_hash": None,
            "trade_ref": str(agg_id),
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
