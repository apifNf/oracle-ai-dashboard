"""
backend/app/workers/news_worker.py

ORACLE :: NewsWorker (Alpha News Feed real-time)

Sumber utama: CryptoCompare / CoinDesk Data
  GET https://min-api.cryptocompare.com/data/v2/news/?lang=EN
  (header: authorization: Apikey <COINDESK/CRYPTOCOMPARE key>)

Fallback (tanpa API key): RSS publik CoinDesk / Cointelegraph / Decrypt / dst.
via feedparser. Keduanya data ASLI — tidak ada dummy.

Item dinormalisasi ke bentuk MarketIntelStore:
  {id, source, title, url, image_url, published_at (ISO, timestamp riil),
   impact (BULLISH|BEARISH|None)}
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any

import httpx

from app.core.config import settings
from app.core.memory import GcPacer
from app.workers.rss_worker import DEFAULT_FEEDS, FeedSource

try:
    import feedparser  # type: ignore
except Exception:  # pragma: no cover
    feedparser = None  # type: ignore

logger = logging.getLogger(__name__)

__all__ = ["NewsWorker"]

CRYPTOCOMPARE_URL = "https://min-api.cryptocompare.com/data/v2/news/"
REQUEST_TIMEOUT = 15.0
MAX_ITEMS = 40

_BULLISH_HINTS = (
    "surge", "rally", "soar", "gain", "bull", "inflow", "breakout", "record high",
    "all-time high", "ath", "approval", "approve", "adopt", "upgrade", "rate cut",
    "cut rates", "partnership", "integrat", "green",
)
_BEARISH_HINTS = (
    "crash", "plunge", "drop", "slump", "bear", "outflow", "hack", "exploit",
    "lawsuit", "sec sues", "ban", "liquidation", "sell-off", "selloff", "rate hike",
    "hike rates", "default", "fraud", "shut down", "delist", "warning", "red",
)


def _classify(text: str) -> str | None:
    low = text.lower()
    if any(h in low for h in _BEARISH_HINTS):
        return "BEARISH"
    if any(h in low for h in _BULLISH_HINTS):
        return "BULLISH"
    return None


class NewsWorker:
    def __init__(self, store: Any, *, poll_interval: int | None = None) -> None:
        self._store = store
        self._key = settings.cryptocompare_api_key
        self._interval = max(45, int(poll_interval or settings.news_poll_seconds))
        self._client: httpx.AsyncClient | None = None
        self._task: asyncio.Task | None = None
        self._etags: dict[str, dict[str, str]] = {}
        self._mode = "cryptocompare" if self._key else "rss"

    async def start(self) -> None:
        if self._task is not None:
            return
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(REQUEST_TIMEOUT),
            follow_redirects=True,
            headers={"User-Agent": "ORACLE-Dashboard/1.0 (+alpha news)"},
        )
        self._task = asyncio.create_task(self._loop(), name="news-worker")
        logger.info("News worker dijalankan (mode=%s).", self._mode)

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
        pacer = GcPacer(every_seconds=180.0, every_calls=3, tag="news")
        while True:
            try:
                n = await self.poll_once()
                logger.info("Siklus berita: %d item baru (mode=%s).", n, self._mode)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Siklus berita gagal; coba lagi siklus berikutnya.")
            pacer.tick()  # feedparser meninggalkan objek besar per siklus
            await asyncio.sleep(self._interval)

    async def poll_once(self) -> int:
        if self._key:
            try:
                return await self._poll_cryptocompare()
            except Exception:
                logger.warning("CryptoCompare gagal; fallback ke RSS untuk siklus ini.")
        return await self._poll_rss()

    # ---------------------- CryptoCompare ------------------------- #

    async def _poll_cryptocompare(self) -> int:
        assert self._client is not None
        resp = await self._client.get(
            CRYPTOCOMPARE_URL,
            params={"lang": "EN"},
            headers={"authorization": f"Apikey {self._key}"},
        )
        resp.raise_for_status()
        payload = resp.json()
        rows = payload.get("Data") or []
        if not isinstance(rows, list):
            raise ValueError("Bentuk payload CryptoCompare tidak dikenali.")

        items: list[dict[str, Any]] = []
        for r in rows[:MAX_ITEMS]:
            title = (r.get("title") or "").strip()
            url = r.get("url") or r.get("guid")
            if not title or not url:
                continue
            ts = r.get("published_on")
            published = (
                datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
                if ts
                else datetime.now(tz=timezone.utc).isoformat()
            )
            src = (r.get("source_info") or {}).get("name") or r.get("source") or "CryptoCompare"
            haystack = f"{title} {r.get('categories','')} {r.get('tags','')}"
            items.append(
                {
                    "id": str(r.get("id") or r.get("guid") or url),
                    "source": str(src).upper(),
                    "title": title[:500],
                    "url": url,
                    "image_url": r.get("imageurl") or None,
                    "published_at": published,
                    "impact": _classify(haystack),
                }
            )
        return self._store.add_news_many(items)

    # ---------------------- RSS fallback -------------------------- #

    async def _poll_rss(self) -> int:
        if feedparser is None:
            logger.error("feedparser tidak terpasang — Alpha News tidak bisa fallback ke RSS.")
            return 0
        results = await asyncio.gather(
            *(self._fetch_feed(f) for f in DEFAULT_FEEDS), return_exceptions=True
        )
        total = 0
        for feed, res in zip(DEFAULT_FEEDS, results):
            if isinstance(res, Exception):
                logger.warning("RSS %s gagal: %s", feed.name, type(res).__name__)
            else:
                total += res
        return total

    async def _fetch_feed(self, feed: FeedSource) -> int:
        assert self._client is not None
        meta = self._etags.get(feed.name, {})
        headers: dict[str, str] = {}
        if meta.get("etag"):
            headers["If-None-Match"] = meta["etag"]
        if meta.get("last_modified"):
            headers["If-Modified-Since"] = meta["last_modified"]

        resp = await self._client.get(feed.url, headers=headers)
        if resp.status_code == 304:
            return 0
        resp.raise_for_status()

        new_meta: dict[str, str] = {}
        if resp.headers.get("ETag"):
            new_meta["etag"] = resp.headers["ETag"]
        if resp.headers.get("Last-Modified"):
            new_meta["last_modified"] = resp.headers["Last-Modified"]
        if new_meta:
            self._etags[feed.name] = new_meta

        parsed = await asyncio.get_running_loop().run_in_executor(
            None, feedparser.parse, resp.content
        )
        if getattr(parsed, "bozo", 0) and not parsed.entries:
            raise ValueError(f"XML tidak bisa diparse dari {feed.name}")

        items: list[dict[str, Any]] = []
        for entry in parsed.entries[:20]:
            link = (getattr(entry, "link", "") or "").strip()
            title = (getattr(entry, "title", "") or "").strip()
            if not link or not title:
                continue
            identity = (getattr(entry, "id", "") or link).strip()
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
            if image_url is None:
                thumb = getattr(entry, "media_thumbnail", None) or []
                if thumb and isinstance(thumb[0], dict):
                    image_url = thumb[0].get("url")
            items.append(
                {
                    "id": hashlib.sha256(f"{feed.name}|{identity}".encode()).hexdigest(),
                    "source": feed.name.upper(),
                    "title": title[:500],
                    "url": link,
                    "image_url": image_url,
                    "published_at": _entry_date(entry),
                    "impact": _classify(title),
                }
            )
        added = self._store.add_news_many(items)
        # feedparser mengembalikan struktur besar; lepas segera.
        del parsed
        return added


def _entry_date(entry: Any) -> str:
    for attr in ("published", "updated"):
        v = getattr(entry, attr, None)
        if v:
            try:
                dt = parsedate_to_datetime(v)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.isoformat()
            except (TypeError, ValueError):
                continue
    return datetime.now(tz=timezone.utc).isoformat()
