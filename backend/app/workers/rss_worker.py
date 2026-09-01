"""
backend/app/workers/rss_worker.py

ORACLE :: RssWorker
Background task yang menarik RSS feed, deduplikasi, simpan ke Supabase,
lalu publish ke Redis Pub/Sub.

Catatan async: httpx SUDAH async native — jangan dibungkus run_in_executor.
Yang blocking di sini adalah feedparser (parsing XML murni CPU/sync), dan
ITU yang dilempar ke executor supaya event loop tidak membeku.

Catatan keamanan: daftar feed bersifat allowlist statis. Jangan pernah
menerima URL feed dari input user — itu SSRF, dan backend kamu bisa dipakai
memindai jaringan internal Render.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Iterable

import feedparser
import httpx

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
)

POLL_INTERVAL_SECONDS = 300
DEDUPE_TTL_SECONDS = 7 * 24 * 3600
MAX_ITEMS_PER_FEED = 25
MAX_FEED_BYTES = 5 * 1024 * 1024
REQUEST_TIMEOUT = 15.0

REDIS_SEEN_PREFIX = "oracle:news:seen:"
REDIS_META_PREFIX = "oracle:news:meta:"
CHANNEL_NEWS = "oracle:stream:news"


class RssWorker:
    def __init__(self, redis_client: Any, supabase: Any,
                 feeds: Iterable[FeedSource] = DEFAULT_FEEDS) -> None:
        self._redis = redis_client
        self._db = supabase
        self._feeds = tuple(feeds)
        self._client: httpx.AsyncClient | None = None
        self._task: asyncio.Task | None = None

    # ---------------------- daur hidup ----------------------------------- #

    async def start(self) -> None:
        if self._task is not None:
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
        while True:
            try:
                count = await self.poll_once()
                logger.info("Siklus RSS selesai, %d berita baru.", count)
            except asyncio.CancelledError:
                raise
            except Exception:
                # Satu siklus gagal tidak boleh mematikan worker permanen.
                logger.exception("Siklus RSS gagal; mencoba lagi siklus berikutnya.")
            await asyncio.sleep(POLL_INTERVAL_SECONDS)

    # ---------------------- inti ----------------------------------------- #

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
            return 0  # 304 Not Modified, atau gagal

        # feedparser itu sinkron dan bisa makan puluhan ms untuk feed besar.
        # Di sinilah run_in_executor dipakai — bukan untuk httpx.
        parsed = await asyncio.get_running_loop().run_in_executor(
            None, feedparser.parse, raw
        )

        if getattr(parsed, "bozo", 0) and not parsed.entries:
            raise ValueError(f"XML tidak bisa diparse dari {feed.name}")

        new_count = 0
        for entry in parsed.entries[:MAX_ITEMS_PER_FEED]:
            item = self._normalize(feed, entry)
            if item is None:
                continue
            if await self._is_duplicate(item["dedupe_hash"]):
                continue
            await self._persist(item)
            new_count += 1

        return new_count

    async def _fetch(self, feed: FeedSource) -> bytes | None:
        """Conditional GET. Menghemat bandwidth dan menghindari blokir."""
        assert self._client is not None
        meta_key = f"{REDIS_META_PREFIX}{feed.name}"

        headers: dict[str, str] = {}
        try:
            meta = await self._redis.hgetall(meta_key)
            meta = {self._to_str(k): self._to_str(v) for k, v in (meta or {}).items()}
            if meta.get("etag"):
                headers["If-None-Match"] = meta["etag"]
            if meta.get("last_modified"):
                headers["If-Modified-Since"] = meta["last_modified"]
        except Exception:
            logger.debug("Metadata cache tidak terbaca untuk %s.", feed.name)

        response = await self._client.get(feed.url, headers=headers)

        if response.status_code == 304:
            return None
        response.raise_for_status()

        content = response.content
        if len(content) > MAX_FEED_BYTES:
            raise ValueError(f"Feed {feed.name} melebihi {MAX_FEED_BYTES} byte.")

        try:
            new_meta = {}
            if response.headers.get("ETag"):
                new_meta["etag"] = response.headers["ETag"]
            if response.headers.get("Last-Modified"):
                new_meta["last_modified"] = response.headers["Last-Modified"]
            if new_meta:
                await self._redis.hset(meta_key, mapping=new_meta)
                await self._redis.expire(meta_key, DEDUPE_TTL_SECONDS)
        except Exception:
            logger.debug("Gagal menyimpan metadata feed %s.", feed.name)

        return content

    # ---------------------- normalisasi ---------------------------------- #

    @staticmethod
    def _normalize(feed: FeedSource, entry: Any) -> dict[str, Any] | None:
        link = (getattr(entry, "link", "") or "").strip()
        title = (getattr(entry, "title", "") or "").strip()
        if not link or not title:
            return None

        # guid lebih stabil daripada link (link bisa berubah query param-nya).
        identity = (getattr(entry, "id", "") or link).strip()
        dedupe_hash = hashlib.sha256(
            f"{feed.name}|{identity}".encode("utf-8")
        ).hexdigest()

        published = RssWorker._parse_date(entry)

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

        summary = (getattr(entry, "summary", "") or "")[:2000] or None

        return {
            "dedupe_hash": dedupe_hash,
            "source": feed.name,
            "title": title[:500],
            "url": link,
            "image_url": image_url,
            "summary": summary,
            "published_at": published.isoformat(),
            # Sengaja None. Klasifikasi sentimen dilakukan modul terpisah,
            # dan sampai itu terjadi, field ini harus jujur kosong.
            "impact": None,
        }

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

    # ---------------------- dedupe & simpan ------------------------------ #

    async def _is_duplicate(self, dedupe_hash: str) -> bool:
        """
        SET NX bersifat atomik: kalau dua worker memproses feed yang sama
        bersamaan, hanya satu yang mendapat True.
        """
        key = f"{REDIS_SEEN_PREFIX}{dedupe_hash}"
        try:
            acquired = await self._redis.set(key, "1", nx=True, ex=DEDUPE_TTL_SECONDS)
            return not acquired
        except Exception:
            # Redis mati: lanjut saja. Constraint UNIQUE di Postgres adalah
            # jaring pengaman kedua.
            logger.warning("Dedupe Redis tidak tersedia; mengandalkan constraint DB.")
            return False

    async def _persist(self, item: dict[str, Any]) -> None:
        try:
            self._db.table("news_items").upsert(
                item, on_conflict="dedupe_hash", ignore_duplicates=True
            ).execute()
        except Exception:
            logger.exception("Gagal menyimpan berita ke Supabase.")
            return

        try:
            import json
            await self._redis.publish(CHANNEL_NEWS, json.dumps(item, default=str))
        except Exception:
            logger.debug("Publish Pub/Sub gagal (tidak fatal).")

    @staticmethod
    def _to_str(value: Any) -> str:
        return value.decode() if isinstance(value, bytes) else str(value)