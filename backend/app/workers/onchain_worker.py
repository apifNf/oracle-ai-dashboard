"""
backend/app/workers/onchain_worker.py

ORACLE :: OnChainWorker
Pelacak transaksi whale (Misi 1).

Sumber: JSON-RPC Ethereum publik (tanpa API key). Setiap siklus:
  1. eth_blockNumber          -> tinggi blok terbaru
  2. eth_getBlockByNumber(full) untuk blok yang belum diproses
  3. Untuk tiap transaksi, nilai transfer native ETH dikonversi ke USD memakai
     harga spot ETHUSDT dari Binance. Transaksi >= WHALE_THRESHOLD_USD didorong
     ke MarketIntelStore.

Batasan yang jujur:
  - Hanya transfer ETH native. Transfer stablecoin ERC-20 (USDT/USDC) tidak
    terlihat di field `value` — itu event log, di luar cakupan versi ini.
  - Kalau harga ETH tidak bisa diambil, siklus dilewati (tidak mengarang kurs).
  - Kalau RPC gagal, panel akan tampil "empty" dengan jujur, bukan data palsu.

Redis/Supabase opsional: kalau ada, event di-mirror; kalau tidak, store
in-process adalah satu-satunya jalur dan itu cukup.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

__all__ = ["OnChainWorker"]

BINANCE_PRICE_URL = "https://api.binance.com/api/v3/ticker/price"
REQUEST_TIMEOUT = 15.0
MAX_BLOCKS_PER_CYCLE = 5          # jangan mengejar terlalu jauh sekaligus
MAX_TX_SCANNED_PER_BLOCK = 400
PRICE_REFRESH_SECONDS = 60
CHANNEL_ONCHAIN = "oracle:stream:onchain"

# ERC-20 Transfer(address,address,uint256) topic0.
_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

# Stablecoin utama di Ethereum mainnet. Mayoritas pergerakan whale nyata adalah
# transfer stablecoin (ERC-20), bukan ETH native — jadi keduanya dipindai.
# (kontrak, simbol, desimal, harga USD asumsi 1:1 untuk stablecoin)
_ERC20_WATCH = {
    "0xdac17f958d2ee523a2206206994597c13d831ec7": ("USDT", 6, 1.0),
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": ("USDC", 6, 1.0),
    "0x6b175474e89094c44da98b954eedeac495271d0f": ("DAI", 18, 1.0),
}


def _topic_addr(topic: str) -> str:
    """32-byte topic -> alamat 0x… (20 byte terakhir)."""
    t = topic[2:] if topic.startswith("0x") else topic
    return "0x" + t[-40:]


class OnChainWorker:
    def __init__(
        self,
        store: Any,
        *,
        rpc_url: str,
        threshold_usd: float = 500_000.0,
        poll_interval: int = 20,
        redis_client: Any | None = None,
        supabase: Any | None = None,
    ) -> None:
        self._store = store
        self._rpc_url = rpc_url
        self._threshold = float(threshold_usd)
        self._poll_interval = max(5, int(poll_interval))
        self._redis = redis_client
        self._db = supabase

        self._client: httpx.AsyncClient | None = None
        self._task: asyncio.Task | None = None
        self._rpc_id = 0
        self._last_block: int | None = None
        self._eth_price: float | None = None
        self._eth_price_at: float = 0.0

    # ---------------------- daur hidup ------------------------------ #

    async def start(self) -> None:
        if self._task is not None:
            return
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(REQUEST_TIMEOUT),
            headers={
                "Content-Type": "application/json",
                "User-Agent": "ORACLE-Dashboard/1.0 (+onchain stream)",
            },
        )
        self._task = asyncio.create_task(self._loop(), name="onchain-worker")
        logger.info("On-chain worker dijalankan (rpc=%s).", self._rpc_url)

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _loop(self) -> None:
        try:
            await self.poll_once()
        except Exception:
            logger.exception("Siklus on-chain awal gagal.")
        while True:
            await asyncio.sleep(self._poll_interval)
            try:
                await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Siklus on-chain gagal; lanjut siklus berikutnya.")

    # ---------------------- inti ---------------------------------- #

    async def poll_once(self) -> int:
        price = await self._get_eth_price()
        if price is None:
            logger.warning("Harga ETH tidak tersedia; siklus on-chain dilewati.")
            return 0

        head = await self._rpc("eth_blockNumber", [])
        if head is None:
            return 0
        head_num = _hex_int(head)
        if head_num is None:
            return 0

        if self._last_block is None:
            start = head_num  # siklus pertama: hanya blok terbaru
        else:
            start = self._last_block + 1
        if start > head_num:
            return 0

        blocks = list(range(start, head_num + 1))[-MAX_BLOCKS_PER_CYCLE:]
        emitted = 0
        for block_num in blocks:
            emitted += await self._scan_block_native(block_num, price)
            emitted += await self._scan_block_erc20(block_num)
            self._last_block = block_num
        return emitted

    async def _scan_block_native(self, block_num: int, eth_price: float) -> int:
        block = await self._rpc(
            "eth_getBlockByNumber", [hex(block_num), True]
        )
        if not isinstance(block, dict):
            return 0

        txs = block.get("transactions") or []
        block_ts = _hex_int(block.get("timestamp")) or int(
            datetime.now(tz=timezone.utc).timestamp()
        )
        received_iso = datetime.fromtimestamp(block_ts, tz=timezone.utc).isoformat()

        rows: list[dict[str, Any]] = []
        for tx in txs[:MAX_TX_SCANNED_PER_BLOCK]:
            if not isinstance(tx, dict):
                continue
            wei = _hex_int(tx.get("value"))
            if not wei:
                continue
            eth = wei / 1e18
            usd = eth * eth_price
            if usd < self._threshold:
                continue

            tx_hash = str(tx.get("hash") or "")
            rows.append(
                {
                    "id": tx_hash or f"{block_num}:{tx.get('transactionIndex')}",
                    "event_type": "TX",
                    "network": "ethereum",
                    "asset": "ETH",
                    "amount_display": _fmt_amount(eth),
                    "amount_usd": round(usd, 2),
                    "from_address": tx.get("from"),
                    "to_address": tx.get("to"),
                    "tx_hash": tx_hash,
                    "block_number": block_num,
                    "status": "IMPORTANT" if usd >= self._threshold * 2 else "BULLISH",
                    "received_at": received_iso,
                }
            )

        if not rows:
            return 0

        new_count = self._store.add_onchain_many(rows)
        if new_count:
            await self._mirror(rows)
        if new_count:
            logger.info(
                "Blok %d: %d transfer ETH native >= $%.0f.",
                block_num, new_count, self._threshold,
            )
        return new_count

    async def _scan_block_erc20(self, block_num: int) -> int:
        """
        Transfer stablecoin ERC-20 (USDT/USDC/DAI) >= threshold via eth_getLogs.
        Di sinilah mayoritas aktivitas whale nyata terlihat — field `value` di
        transaksi hanya menangkap ETH native.
        """
        logs = await self._rpc(
            "eth_getLogs",
            [
                {
                    "fromBlock": hex(block_num),
                    "toBlock": hex(block_num),
                    "address": list(_ERC20_WATCH.keys()),
                    "topics": [_TRANSFER_TOPIC],
                }
            ],
        )
        if not isinstance(logs, list) or not logs:
            return 0

        received_iso = datetime.now(tz=timezone.utc).isoformat()
        rows: list[dict[str, Any]] = []
        for log in logs:
            if not isinstance(log, dict):
                continue
            token = _ERC20_WATCH.get(str(log.get("address", "")).lower())
            topics = log.get("topics") or []
            if token is None or len(topics) < 3:
                continue
            symbol, decimals, unit_usd = token
            raw = _hex_int(log.get("data"))
            if not raw:
                continue
            amount = raw / (10 ** decimals)
            usd = amount * unit_usd
            if usd < self._threshold:
                continue

            tx_hash = str(log.get("transactionHash") or "")
            log_index = str(log.get("logIndex") or "0")
            rows.append(
                {
                    "id": f"{tx_hash}:{log_index}",
                    "event_type": "TX",
                    "network": "ethereum",
                    "asset": symbol,
                    "amount_display": _fmt_amount(amount),
                    "amount_usd": round(usd, 2),
                    "from_address": _topic_addr(topics[1]),
                    "to_address": _topic_addr(topics[2]),
                    "tx_hash": tx_hash,
                    "block_number": block_num,
                    "status": "IMPORTANT" if usd >= self._threshold * 2 else "BULLISH",
                    "received_at": received_iso,
                }
            )

        if not rows:
            return 0
        new_count = self._store.add_onchain_many(rows)
        if new_count:
            await self._mirror(rows)
            logger.info(
                "Blok %d: %d transfer stablecoin whale >= $%.0f.",
                block_num, new_count, self._threshold,
            )
        return new_count

    # ---------------------- RPC & harga -------------------------- #

    async def _rpc(self, method: str, params: list[Any]) -> Any:
        assert self._client is not None
        self._rpc_id += 1
        payload = {"jsonrpc": "2.0", "id": self._rpc_id, "method": method, "params": params}
        try:
            response = await self._client.post(self._rpc_url, json=payload)
            response.raise_for_status()
            body = response.json()
        except Exception as exc:
            logger.warning("RPC %s gagal: %s", method, type(exc).__name__)
            return None
        if isinstance(body, dict) and body.get("error"):
            logger.warning("RPC %s error: %s", method, body["error"])
            return None
        return body.get("result") if isinstance(body, dict) else None

    async def _get_eth_price(self) -> float | None:
        now = datetime.now(tz=timezone.utc).timestamp()
        if self._eth_price is not None and now - self._eth_price_at < PRICE_REFRESH_SECONDS:
            return self._eth_price
        assert self._client is not None
        try:
            response = await self._client.get(
                BINANCE_PRICE_URL, params={"symbol": "ETHUSDT"}
            )
            response.raise_for_status()
            price = float(response.json()["price"])
        except Exception as exc:
            logger.warning("Harga ETHUSDT gagal diambil: %s", type(exc).__name__)
            return self._eth_price  # pakai harga lama kalau ada
        if price > 0:
            self._eth_price = price
            self._eth_price_at = now
        return self._eth_price

    # ---------------------- mirror opsional --------------------- #

    async def _mirror(self, rows: list[dict[str, Any]]) -> None:
        if self._db is not None:
            try:
                self._db.table("onchain_events").upsert(
                    rows, on_conflict="id", ignore_duplicates=True
                ).execute()
            except Exception:
                logger.debug("Mirror Supabase on-chain gagal (tidak fatal).")
        if self._redis is not None:
            try:
                for row in rows:
                    await self._redis.publish(CHANNEL_ONCHAIN, json.dumps(row, default=str))
            except Exception:
                logger.debug("Publish Redis on-chain gagal (tidak fatal).")


# --------------------------------------------------------------------------- #
# Util
# --------------------------------------------------------------------------- #


def _hex_int(value: Any) -> int | None:
    try:
        if isinstance(value, str):
            return int(value, 16) if value.startswith("0x") else int(value)
        if isinstance(value, int):
            return value
    except (TypeError, ValueError):
        return None
    return None


def _fmt_amount(amount: float) -> str:
    if amount >= 1_000_000:
        return f"{amount / 1_000_000:.2f}M"
    if amount >= 1_000:
        return f"{amount / 1_000:.2f}K"
    return f"{amount:,.4f}".rstrip("0").rstrip(".")
