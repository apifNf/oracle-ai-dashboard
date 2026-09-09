"""
backend/app/services/orderbook_service.py

ORACLE :: OrderBookService (Level 2 depth, ON-DEMAND)

Sumber: Bybit v5 `GET /v5/market/orderbook` (publik, tanpa API key).

KONTRAK MEMORI — ini alasan modul ini ada dan kenapa bentuknya begini:
  - TIDAK ada background task. TIDAK ada worker. TIDAK ada WebSocket global.
    Data hanya diambil saat ada request masuk untuk SATU simbol.
  - Order book adalah struktur paling boros di seluruh sistem (ratusan level,
    berubah tiap milidetik). Melanggan 30 simbol sekaligus di background akan
    membuat RSS meledak — persis skenario OOM Render yang kita hindari.
  - Satu-satunya state yang disimpan adalah cache TTL ~1 detik dengan BATAS
    KERAS jumlah simbol (LRU). Tujuannya bukan menyimpan riwayat, tapi meredam
    banyak klien yang memantau simbol sama supaya tidak melipatgandakan
    request keluar. Ukurannya konstan, tidak tumbuh seiring waktu.

Bentuk respons dinormalisasi supaya frontend tinggal merender: `total` sudah
kumulatif dari harga terbaik, `max_total` untuk lebar depth bar.

Sesuai prinsip proyek: kalau bursa gagal, kembalikan status "unavailable"
dengan error — bukan bids/asks kosong yang terlihat seperti pasar sepi.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

__all__ = ["OrderBookService", "OrderBookError"]

# Rantai sumber upstream, dicoba berurutan. api.bybit.com sering membalas
# 403/451 dari IP datacenter AS (Render) — sama seperti kasus onchain_worker.
# api.bytick.com adalah domain MIRROR RESMI Bybit dengan bentuk respons identik;
# OKX dipakai sebagai cadangan lintas-bursa (bentuk respons berbeda, di-parse
# terpisah). Semua publik, tanpa API key.
BYBIT_ORDERBOOK_HOSTS = (
    "https://api.bybit.com/v5/market/orderbook",
    "https://api.bytick.com/v5/market/orderbook",
)
OKX_ORDERBOOK_URL = "https://www.okx.com/api/v5/market/books"
REQUEST_TIMEOUT = 6.0

# Cache TTL pendek: cukup untuk meredam polling 1-2 detik dari banyak klien,
# terlalu pendek untuk dianggap data basi oleh trader.
CACHE_TTL_SECONDS = 1.0
# Batas keras jumlah simbol yang di-cache. Ini yang menjaga memori konstan:
# simbol ke-33 mengusir yang paling lama tidak dipakai.
CACHE_MAX_SYMBOLS = 32

DEPTH_MIN = 1
DEPTH_MAX = 50          # UI hanya butuh ~15-25 baris; jangan tarik 200 level.
DEPTH_DEFAULT = 20

# Simbol hanya boleh huruf+angka. Gerbang ini mencegah nilai dari user
# menempel mentah ke URL pihak ketiga (allowlist, bukan sanitasi longgar).
_SYMBOL_RE = re.compile(r"^[A-Z0-9]{4,24}$")

_CATEGORY = {"spot": "spot", "futures": "linear"}


class OrderBookError(RuntimeError):
    """Simbol tidak valid, atau bursa tidak bisa dihubungi."""


def _to_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and abs(number) != float("inf") else None


def normalize_symbol(symbol: str) -> str:
    """'btc' / 'BTC/USDT' / 'btc-usdt' -> 'BTCUSDT'."""
    s = (symbol or "").upper().replace("/", "").replace("-", "").replace("_", "").strip()
    if not s:
        raise OrderBookError("Simbol kosong.")
    if not s.endswith(("USDT", "USDC", "USD")):
        s = f"{s}USDT"
    if not _SYMBOL_RE.match(s):
        raise OrderBookError(f"Simbol '{symbol}' tidak valid.")
    return s


class OrderBookService:
    """
    Klien order book on-demand.

    Instansiasi murah (tidak membuka koneksi apa pun sampai fetch pertama), jadi
    aman dibuat di lifespan tanpa menambah beban boot.
    """

    def __init__(
        self,
        *,
        ttl_seconds: float = CACHE_TTL_SECONDS,
        max_symbols: int = CACHE_MAX_SYMBOLS,
    ) -> None:
        self._client: httpx.AsyncClient | None = None
        self._ttl = float(ttl_seconds)
        self._max_symbols = int(max_symbols)
        # key -> (monotonic_ts, payload). OrderedDict dipakai sebagai LRU.
        self._cache: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()
        self._lock = asyncio.Lock()

    def _get_client(self) -> httpx.AsyncClient:
        # Satu klien dipakai ulang (bukan per request) — lihat CLAUDE.md.
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(REQUEST_TIMEOUT),
                headers={
                    "Accept": "application/json",
                    "User-Agent": "ORACLE-Dashboard/1.0 (+orderbook on-demand)",
                },
                limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
        self._cache.clear()

    # ---------------------- cache ---------------------------------- #

    def _cache_get(self, key: str) -> dict[str, Any] | None:
        entry = self._cache.get(key)
        if entry is None:
            return None
        stamped_at, payload = entry
        if time.monotonic() - stamped_at > self._ttl:
            self._cache.pop(key, None)
            return None
        self._cache.move_to_end(key)  # dipakai = paling baru
        return payload

    def _cache_put(self, key: str, payload: dict[str, Any]) -> None:
        self._cache[key] = (time.monotonic(), payload)
        self._cache.move_to_end(key)
        # Batas keras: memori tetap konstan berapa pun simbol yang diminta.
        while len(self._cache) > self._max_symbols:
            self._cache.popitem(last=False)

    # ---------------------- fetch ---------------------------------- #

    async def fetch(
        self,
        symbol: str,
        *,
        market_type: str = "spot",
        depth: int = DEPTH_DEFAULT,
    ) -> dict[str, Any]:
        """
        Ambil satu snapshot order book. Dipanggil per request — tidak ada
        langganan yang tertinggal hidup setelah fungsi ini selesai.
        """
        sym = normalize_symbol(symbol)
        mt = (market_type or "spot").strip().lower()
        if mt in ("futures", "future", "swap", "perp", "perpetual"):
            mt = "futures"
        else:
            mt = "spot"
        category = _CATEGORY[mt]
        depth = max(DEPTH_MIN, min(int(depth or DEPTH_DEFAULT), DEPTH_MAX))

        key = f"{category}:{sym}:{depth}"
        cached = self._cache_get(key)
        if cached is not None:
            return {**cached, "cached": True}

        # Lock hanya melindungi cache; request keluar tetap paralel antar simbol.
        async with self._lock:
            cached = self._cache_get(key)
            if cached is not None:
                return {**cached, "cached": True}

            payload = await self._fetch_upstream(sym, category, depth, mt)
            if payload.get("status") == "ok":
                self._cache_put(key, payload)
            return {**payload, "cached": False}

    async def _fetch_upstream(
        self, sym: str, category: str, depth: int, market_type: str
    ) -> dict[str, Any]:
        base = {
            "symbol": sym,
            "pair": _pretty_pair(sym),
            "market_type": market_type,
            "category": category,
            "depth": depth,
        }

        errors: list[str] = []
        for name, fetch in (
            ("bybit", lambda: self._src_bybit(BYBIT_ORDERBOOK_HOSTS[0], sym, category, depth)),
            ("bytick", lambda: self._src_bybit(BYBIT_ORDERBOOK_HOSTS[1], sym, category, depth)),
            ("okx", lambda: self._src_okx(sym, category, depth)),
        ):
            try:
                bids, asks, ts = await fetch()
            except Exception as exc:
                errors.append(f"{name}:{type(exc).__name__}")
                logger.warning(
                    "Order book %s (%s) via %s gagal: %s",
                    sym, category, name, type(exc).__name__,
                )
                continue

            if not bids or not asks:
                errors.append(f"{name}:empty")
                continue

            if name != "bybit":
                logger.info(
                    "Order book %s diambil dari sumber cadangan '%s' (bybit diblokir?).",
                    sym, name,
                )

            best_bid = bids[0]["price"]
            best_ask = asks[0]["price"]
            spread = best_ask - best_bid
            mid = (best_ask + best_bid) / 2

            return {
                **base,
                "source": name,
                "status": "ok",
                "as_of": (
                    datetime.fromtimestamp(ts / 1000, tz=timezone.utc).isoformat()
                    if ts else datetime.now(tz=timezone.utc).isoformat()
                ),
                "bids": bids,
                "asks": asks,
                "best_bid": best_bid,
                "best_ask": best_ask,
                "mid_price": round(mid, 8),
                "spread": round(spread, 8),
                "spread_pct": round((spread / mid) * 100, 4) if mid else None,
                # Dipakai frontend untuk lebar depth bar — dihitung sekali di sini
                # supaya tiap render tidak menyapu ulang kedua sisi buku.
                "max_total": max(bids[-1]["total"], asks[-1]["total"]),
                "error": None,
            }

        # Sesuai prinsip proyek: bursa gagal -> "unavailable" dengan alasan,
        # BUKAN bids/asks kosong yang terlihat seperti pasar sepi.
        return {
            **base,
            "source": "bybit",
            "status": "unavailable",
            "bids": [], "asks": [],
            "as_of": None, "mid_price": None, "spread": None,
            "spread_pct": None, "max_total": None,
            "error": {
                "code": "upstream_failed",
                "message": f"Order book {sym} tidak bisa diambil ({'; '.join(errors)}).",
            },
        }

    async def _src_bybit(
        self, url: str, sym: str, category: str, depth: int
    ) -> tuple[list[dict[str, float]], list[dict[str, float]], float | None]:
        """Bybit v5 /market/orderbook (host utama ATAU mirror bytick — bentuk sama)."""
        resp = await self._get_client().get(
            url, params={"category": category, "symbol": sym, "limit": depth}
        )
        resp.raise_for_status()
        body = resp.json()
        if str(body.get("retCode", "0")) != "0":
            raise OrderBookError(f"retCode={body.get('retCode')} {body.get('retMsg')}")
        result = body.get("result") or {}
        # b = bids (harga menurun), a = asks (harga menaik).
        return _levels(result.get("b")), _levels(result.get("a")), _to_float(result.get("ts"))

    async def _src_okx(
        self, sym: str, category: str, depth: int
    ) -> tuple[list[dict[str, float]], list[dict[str, float]], float | None]:
        """OKX /api/v5/market/books — cadangan lintas-bursa, ramah IP AS."""
        resp = await self._get_client().get(
            OKX_ORDERBOOK_URL, params={"instId": _okx_inst(sym, category), "sz": depth}
        )
        resp.raise_for_status()
        body = resp.json()
        if str(body.get("code", "0")) != "0":
            raise OrderBookError(f"code={body.get('code')} {body.get('msg')}")
        rows = body.get("data") or []
        if not rows:
            return [], [], None
        row = rows[0]
        # OKX row: [price, size, deprecated, num_orders] — _levels hanya baca 2 kolom pertama.
        return _levels(row.get("bids")), _levels(row.get("asks")), _to_float(row.get("ts"))


def _levels(raw: Any) -> list[dict[str, float]]:
    """
    [['79409', '0.149768'], ...] -> [{price, size, total}], `total` kumulatif
    dari harga terbaik (konvensi order book profesional).
    """
    if not isinstance(raw, list):
        return []
    out: list[dict[str, float]] = []
    running = 0.0
    for row in raw:
        if not isinstance(row, (list, tuple)) or len(row) < 2:
            continue
        price = _to_float(row[0])
        size = _to_float(row[1])
        if price is None or size is None or price <= 0 or size <= 0:
            continue
        running += size
        out.append(
            {"price": price, "size": size, "total": round(running, 8)}
        )
    return out


def _pretty_pair(symbol: str) -> str:
    for quote in ("USDT", "USDC", "USD"):
        if symbol.endswith(quote) and len(symbol) > len(quote):
            return f"{symbol[: -len(quote)]}/{quote}"
    return symbol


def _okx_inst(symbol: str, category: str) -> str:
    """'BTCUSDT' -> 'BTC-USDT' (spot) / 'BTC-USDT-SWAP' (linear perpetual)."""
    for quote in ("USDT", "USDC", "USD"):
        if symbol.endswith(quote) and len(symbol) > len(quote):
            pair = f"{symbol[: -len(quote)]}-{quote}"
            return f"{pair}-SWAP" if category == "linear" else pair
    return symbol
