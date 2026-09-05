"""
backend/app/services/market_intel_store.py

ORACLE :: MarketIntelStore

Penyimpan in-process untuk feed Market Intelligence (Misi 1).

Kenapa in-process, bukan Redis/Supabase:
  - Deploy ORACLE saat ini tidak menjalankan Redis maupun Supabase, dan paket
    kliennya tidak terpasang. Versi lama market_intel.py mengasumsikan keduanya
    ada di `app.state`, sehingga endpoint /news dan /onchain selalu jatuh ke
    cabang "degraded".
  - Feed ini murni turunan dari sumber publik (RSS XML + JSON-RPC Ethereum).
    Tidak ada data milik user, tidak ada yang perlu persist lintas restart.
    Ring buffer di memori sudah cukup dan menghapus seluruh kelas kegagalan
    "infrastruktur pendukung mati".

Bila nanti Redis/Supabase dipasang, worker bisa menulis ke sana JUGA; store ini
tetap jadi jalur cepat yang dibaca endpoint.

Akses selalu dari event loop utama (worker asyncio + handler FastAPI), jadi
`collections.deque` tanpa lock sudah aman. `deque.appendleft` dan slicing
bersifat atomik terhadap operasi lain di loop yang sama.
"""

from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from typing import Any, Iterable

__all__ = ["MarketIntelStore"]

NEWS_CAPACITY = 120
ONCHAIN_CAPACITY = 60


class MarketIntelStore:
    def __init__(
        self,
        news_capacity: int = NEWS_CAPACITY,
        onchain_capacity: int = ONCHAIN_CAPACITY,
    ) -> None:
        self._news: deque[dict[str, Any]] = deque(maxlen=news_capacity)
        self._onchain: deque[dict[str, Any]] = deque(maxlen=onchain_capacity)
        self._seen_news: set[str] = set()
        self._seen_onchain: set[str] = set()
        self._news_updated_at: float | None = None
        self._onchain_updated_at: float | None = None

    # ---------------------- berita -------------------------------------- #

    def add_news(self, item: dict[str, Any]) -> bool:
        """Return True bila item benar-benar baru (bukan duplikat)."""
        key = str(item.get("id") or item.get("url") or item.get("title") or "")
        if not key or key in self._seen_news:
            return False
        self._seen_news.add(key)
        self._news.appendleft(item)
        self._prune_seen(self._seen_news, self._news, "id", "url", "title")
        self._news_updated_at = _now_ts()
        return True

    def add_news_many(self, items: Iterable[dict[str, Any]]) -> int:
        return sum(1 for it in items if self.add_news(it))

    def recent_news(self, limit: int = 30) -> list[dict[str, Any]]:
        limit = max(1, min(limit, len(self._news) or 1))
        return list(self._news)[:limit]

    # ---------------------- on-chain ----------------------------------- #

    def add_onchain(self, item: dict[str, Any]) -> bool:
        key = str(item.get("id") or item.get("tx_hash") or "")
        if not key or key in self._seen_onchain:
            return False
        self._seen_onchain.add(key)
        self._onchain.appendleft(item)
        self._prune_seen(self._seen_onchain, self._onchain, "id", "tx_hash")
        self._onchain_updated_at = _now_ts()
        return True

    def add_onchain_many(self, items: Iterable[dict[str, Any]]) -> int:
        return sum(1 for it in items if self.add_onchain(it))

    def recent_onchain(self, limit: int = 20) -> list[dict[str, Any]]:
        limit = max(1, min(limit, len(self._onchain) or 1))
        return list(self._onchain)[:limit]

    # ---------------------- introspeksi ------------------------------- #

    def health(self) -> dict[str, Any]:
        return {
            "news_items": len(self._news),
            "onchain_items": len(self._onchain),
            "news_updated_at": _iso_or_none(self._news_updated_at),
            "onchain_updated_at": _iso_or_none(self._onchain_updated_at),
        }

    # ---------------------- util ------------------------------------- #

    @staticmethod
    def _prune_seen(
        seen: set[str],
        buffer: "deque[dict[str, Any]]",
        *key_fields: str,
    ) -> None:
        """Jaga set dedupe tidak tumbuh tak terbatas saat buffer sudah rotasi."""
        if len(seen) <= buffer.maxlen * 4:  # type: ignore[operator]
            return
        live: set[str] = set()
        for row in buffer:
            for field in key_fields:
                value = row.get(field)
                if value:
                    live.add(str(value))
                    break
        seen.intersection_update(live)


def _now_ts() -> float:
    return datetime.now(tz=timezone.utc).timestamp()


def _iso_or_none(ts: float | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
