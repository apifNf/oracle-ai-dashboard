"""
backend/app/workers/rss_worker.py

ORACLE :: RssWorker
Background task: tarik RSS feed makro (XML publik), deduplikasi, dorong ke
MarketIntelStore in-process. Redis/Supabase bersifat OPSIONAL — bila diberikan,
item juga di-mirror ke sana, tapi jalur baca utama tetap store in-process.

Catatan async: httpx SUDAH async native — tidak dibungkus run_in_executor.
Yang blocking adalah feedparser (parsing XML sinkron, murni CPU), dan ITU yang
dilempar ke executor supaya event loop tidak membeku.

Catatan keamanan: daftar feed adalah allowlist statis. Jangan pernah menerima
URL feed dari input user — itu SSRF.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Iterable

import httpx

try:  # feedparser wajib untuk worker ini; kalau hilang, worker nonaktif, app tetap hidup.
    import feedparser  # type: ignore
except Exception:  # pragma: no cover - defensive
    feedparser = None  # type: ignore

logger = logging.getLogger(__name__)

__all__ = ["RssWorker", "FeedSource", "DEFAULT_FEEDS"]


@dataclass(frozen=True)
class FeedSource:
    name: str
    url: str


# Allowlist. Tambah di sini, bukan lewat parameter runtime.
DEFAULT_FEEDS: tuple[FeedSource, ...] = (
    FeedSource("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"),
    FeedSource("Cointelegraph", "https://cointelegraph.com/rss"),
    FeedSource("Bitcoin Magazine", "https://bitcoinmagazine.com/feed"),
    FeedSource("Decrypt", "https://decrypt.co/feed"),
    FeedSource("The Block", "https://www.theblock.co/rss.xml"),
)

POLL_INTERVAL_SECONDS = 300
MAX_ITEMS_PER_FEED = 20
MAX_FEED_BYTES = 5 * 1024 * 1024
REQUEST_TIMEOUT = 15.0

CHANNEL_NEWS = "oracle:stream:news"

# Kata kunci klasifikasi dampak makro. Sengaja transparan & bisa diaudit —
# bukan model sentimen. `impact` tetap boleh None kalau tak ada yang cocok.
_BULLISH_HINTS = (
    "surge", "rally", "soar", "gain", "bull", "inflow", "breakout", "record high",
    "all-time high", "ath", "approval", "adopt", "upgrade", "cut rates", "rate cut",
)
_BEARISH_HINTS = (
    "crash", "plunge", "drop", "slump", "bear", "outflow", "hack", "exploit",
    "lawsuit", "sec sues", "ban", "liquidation", "sell-off", "selloff", "hike rates",
    "rate hike", "default",
)


class RssWorker:
    def __init__(
        self,
        store: Any,
        *,
        redis_client: Any | None = None,
        supabase: Any | None = None,
        feeds: Iterable[FeedSource] = DEFAULT_FEEDS,
        poll_interval: int = POLL_INTERVAL_SECONDS,
    ) -> None:
        self._store = store
        self._redis = redis_client
        self._db = supabase
        self._feeds = tuple(feeds)
        self._poll_interval = max(30, int(poll_interval))
        self._client: httpx.AsyncClient | None = None
        self._task: asyncio.Task | None = None
        self._etags: dict[str, dict[str, str]] = {}

    # ---------------------- daur hidup ------------------------------- #

    async def start(self) -> None:
        if self._task is not None:
            return
        if feedparser is None:
            logger.error(
                "feedparser tidak terpasang — RssWorker tidak dijalankan. "
                "Tambahkan 'feedparser' ke dependencies dan pip install -e backend."
            )
            return
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(REQUEST_TIMEOUT),
            follow_redirects=True,
            headers={
                "Accept": "application/rss+xml, application/xml, text/xml",
                "User-Agent": "ORACLE-Dashboard/1.0 (+news aggregator)",
            },
        )
        self._task = asyncio.create_task(self._loop(), name="rss-worker")
        logger.info("RSS worker dijalankan untuk %d feed.", len(self._feeds))

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
        # Isi cepat sekali di awal supaya klien pertama tidak melihat panel kosong.
        try:
            first = await self.poll_once()
            logger.info("Siklus RSS awal: %d berita.", first)
        except Exception:
            logger.exception("Siklus RSS awal gagal.")

        while True:
            await asyncio.sleep(self._poll_interval)
            try:
                count = await self.poll_once()
                logger.info("Siklus RSS selesai, %d berita baru.", count)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Siklus RSS gagal; mencoba lagi siklus berikutnya.")

    # ---------------------- inti ------------------------------------ #

    async def poll_once(self) -> int:
        results = await asyncio.gather(
            *(self._process_feed(f) for f in self._feeds),
            return_exceptions=True,
        )
        total = 0
        for feed, result in zip(self._feeds, results):
            if isinstance(result, Exception):
                logger.warning("Feed %s gagal: %s", feed.name, type(result).__name__)
            else:
                total += result
        return total

    async def _process_feed(self, feed: FeedSource) -> int:
        raw = await self._fetch(feed)
        if raw is None:
            return 0  # 304 Not Modified atau gagal

        parsed = await asyncio.get_running_loop().run_in_executor(
            None, feedparser.parse, raw
        )
        if getattr(parsed, "bozo", 0) and not parsed.entries:
            raise ValueError(f"XML tidak bisa diparse dari {feed.name}")

        items = [
            item
            for entry in parsed.entries[:MAX_ITEMS_PER_FEED]
            if (item := self._normalize(feed, entry)) is not None
        ]
        if not items:
            return 0

        new_count = self._store.add_news_many(items)

        # Mirror opsional ke infrastruktur eksternal bila tersedia.
        if new_count:
            await self._mirror(items)
        return new_count

    async def _fetch(self, feed: FeedSource) -> bytes | None:
        assert self._client is not None
        meta = self._etags.get(feed.name, {})
        headers: dict[str, str] = {}
        if meta.get("etag"):
            headers["If-None-Match"] = meta["etag"]
        if meta.get("last_modified"):
            headers["If-Modified-Since"] = meta["last_modified"]

        response = await self._client.get(feed.url, headers=headers)
        if response.status_code == 304:
            return None
        response.raise_for_status()

        content = response.content
        if len(content) > MAX_FEED_BYTES:
            raise ValueError(f"Feed {feed.name} melebihi {MAX_FEED_BYTES} byte.")

        new_meta: dict[str, str] = {}
        if response.headers.get("ETag"):
            new_meta["etag"] = response.headers["ETag"]
        if response.headers.get("Last-Modified"):
            new_meta["last_modified"] = response.headers["Last-Modified"]
        if new_meta:
            self._etags[feed.name] = new_meta

        return content

    # ---------------------- normalisasi --------------------------- #

    @classmethod
    def _normalize(cls, feed: FeedSource, entry: Any) -> dict[str, Any] | None:
        link = (getattr(entry, "link", "") or "").strip()
        title = (getattr(entry, "title", "") or "").strip()
        if not link or not title:
            return None

        identity = (getattr(entry, "id", "") or link).strip()
        dedupe_hash = hashlib.sha256(
            f"{feed.name}|{identity}".encode("utf-8")
        ).hexdigest()

        published = cls._parse_date(entry)

        image_url = None
        for media in (getattr(entry, "media_content", None) or []):
            if isinstance(media, dict) and media.get("url"):
                image_url = media["url"]
                break
        if image_url is None:
            for enc in (getattr(entry, "enclosures", None) or []):
                if isinstance(enc, dict) and str(enc.get("type", "")).startswith("image/"):
                    image_url = enc.get("href")
                    break

        return {
            "id": dedupe_hash,
            "source": feed.name,
            "title": title[:500],
            "url": link,
            "image_url": image_url,
            "published_at": published.isoformat(),
            "impact": cls._classify_impact(title),
        }

    @staticmethod
    def _classify_impact(title: str) -> str | None:
        low = title.lower()
        if any(h in low for h in _BEARISH_HINTS):
            return "BEARISH"
        if any(h in low for h in _BULLISH_HINTS):
            return "BULLISH"
        return None

    @staticmethod
    def _parse_date(entry: Any) -> datetime:
        for attr in ("published", "updated"):
            value = getattr(entry, attr, None)
            if value:
                try:
                    parsed = parsedate_to_datetime(value)
                    if parsed.tzinfo is None:
                        parsed = parsed.replace(tzinfo=timezone.utc)
                    return parsed
                except (TypeError, ValueError):
                    continue
        return datetime.now(tz=timezone.utc)

    # ---------------------- mirror opsional ----------------------- #

    async def _mirror(self, items: list[dict[str, Any]]) -> None:
        if self._db is not None:
            try:
                self._db.table("news_items").upsert(
                    items, on_conflict="id", ignore_duplicates=True
                ).execute()
            except Exception:
                logger.debug("Mirror Supabase berita gagal (tidak fatal).")
        if self._redis is not None:
            try:
                for item in items:
                    await self._redis.publish(CHANNEL_NEWS, json.dumps(item, default=str))
            except Exception:
                logger.debug("Publish Redis berita gagal (tidak fatal).")
