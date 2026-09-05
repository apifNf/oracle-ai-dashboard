"""
backend/app/api/v1/market_intel.py

ORACLE :: Market Intelligence API (Misi 1)

  GET  /api/v1/market-intel/news            -> Alpha News Feed (RSS makro)
  GET  /api/v1/market-intel/onchain         -> On-Chain Stream (whale > $500k)
  GET  /api/v1/market-intel/health          -> status worker & store
  POST /api/v1/market-intel/webhooks/alchemy-> opsional, dari Alchemy Notify

Router ini SEBELUMNYA tidak pernah didaftarkan di app.api.router, jadi
/news dan /onchain selalu 404. Selain itu versi lama mewajibkan
`app.state.redis` dan `app.state.supabase` yang tidak pernah di-set —
sekarang kedua endpoint baca dari MarketIntelStore in-process
(lihat app.services.market_intel_store) yang diisi oleh:
  - app.workers.rss_worker.RssWorker
  - app.workers.onchain_worker.OnChainWorker

Bentuk respons ("envelope") tidak berubah — frontend membaca `status`,
bukan menebak dari panjang array.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request, status

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/market-intel", tags=["market-intelligence"])

ALCHEMY_SIGNING_KEY = os.getenv("ALCHEMY_WEBHOOK_SIGNING_KEY", "")
MAX_WEBHOOK_BYTES = 1 * 1024 * 1024


# --------------------------------------------------------------------------- #
# Helper
# --------------------------------------------------------------------------- #


def _store(request: Request) -> Any:
    store = getattr(request.app.state, "market_intel_store", None)
    if store is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "MarketIntelStore belum diinisialisasi di lifespan aplikasi.",
        )
    return store


def _envelope(
    items: list[dict[str, Any]] | None,
    state: str,
    error: dict[str, str] | None = None,
) -> dict[str, Any]:
    return {
        "status": state,                 # "ok" | "empty" | "degraded"
        "data": items or [],
        "count": len(items or []),
        "as_of": datetime.now(tz=timezone.utc).isoformat(),
        "error": error,
    }


# --------------------------------------------------------------------------- #
# Endpoint baca
# --------------------------------------------------------------------------- #


@router.get("/news")
async def get_news(request: Request, limit: int = 30) -> dict[str, Any]:
    limit = max(1, min(limit, 100))
    try:
        rows = _store(request).recent_news(limit)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Baca berita dari store gagal.")
        return _envelope(
            None, "degraded",
            {"code": "store_error", "message": "Sumber berita tidak bisa dibaca."},
        )
    return _envelope(rows, "ok" if rows else "empty")


@router.get("/onchain")
async def get_onchain(request: Request, limit: int = 20) -> dict[str, Any]:
    limit = max(1, min(limit, 100))
    try:
        rows = _store(request).recent_onchain(limit)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Baca on-chain dari store gagal.")
        return _envelope(
            None, "degraded",
            {"code": "store_error", "message": "Aliran on-chain tidak bisa dibaca."},
        )
    return _envelope(rows, "ok" if rows else "empty")


@router.get("/health")
async def market_intel_health(request: Request) -> dict[str, Any]:
    store = _store(request)
    return {
        "status": "ok",
        "store": store.health(),
        "workers": {
            "rss": getattr(request.app.state, "rss_worker", None) is not None,
            "onchain": getattr(request.app.state, "onchain_worker", None) is not None,
        },
    }


# --------------------------------------------------------------------------- #
# Webhook Alchemy (opsional)
# --------------------------------------------------------------------------- #


def verify_alchemy_signature(raw_body: bytes, signature: str | None) -> bool:
    """Constant-time. False untuk semua kondisi gagal, tanpa membedakan."""
    if not ALCHEMY_SIGNING_KEY or not signature:
        return False
    expected = hmac.new(
        ALCHEMY_SIGNING_KEY.encode("utf-8"), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature.strip())


@router.post("/webhooks/alchemy", status_code=status.HTTP_200_OK)
async def alchemy_webhook(
    request: Request,
    x_alchemy_signature: str | None = Header(default=None),
) -> dict[str, Any]:
    """
    Jalur push opsional. Kalau ALCHEMY_WEBHOOK_SIGNING_KEY tidak di-set,
    endpoint menolak semua request (bukan diam-diam menerima yang tak
    terautentikasi). Urutan: baca raw body -> verifikasi HMAC -> parse JSON.
    """
    if not ALCHEMY_SIGNING_KEY:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Webhook Alchemy tidak dikonfigurasi.",
        )

    raw_body = await request.body()
    if len(raw_body) > MAX_WEBHOOK_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Payload terlalu besar.")

    if not verify_alchemy_signature(raw_body, x_alchemy_signature):
        logger.warning(
            "Webhook ditolak: tanda tangan tidak valid (client=%s).",
            request.client.host if request.client else "unknown",
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid signature.")

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Body bukan JSON valid.")

    rows = _flatten_alchemy(payload)
    added = _store(request).add_onchain_many(rows) if rows else 0
    return {"status": "accepted", "ingested": added}


def _flatten_alchemy(payload: dict[str, Any]) -> list[dict[str, Any]]:
    delivery_id = str(payload.get("id") or "")
    event = payload.get("event") or {}
    network = event.get("network") or "ethereum"
    created = payload.get("createdAt") or datetime.now(tz=timezone.utc).isoformat()

    activities = event.get("activity") or []
    rows: list[dict[str, Any]] = []
    for index, activity in enumerate(activities[:50]):
        value = _to_float(activity.get("value"))
        asset = (activity.get("asset") or "ETH").upper()
        rows.append(
            {
                "id": f"{delivery_id}:{index}" if delivery_id else f"{activity.get('hash')}:{index}",
                "event_type": "TX",
                "network": network,
                "asset": asset,
                "amount_display": _fmt(value),
                "from_address": activity.get("fromAddress"),
                "to_address": activity.get("toAddress"),
                "tx_hash": activity.get("hash"),
                "block_number": _safe_int(activity.get("blockNum")),
                "status": "IMPORTANT",
                "received_at": created,
            }
        )
    return rows


def _to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _fmt(value: float | None) -> str | None:
    if value is None:
        return None
    if value >= 1_000_000:
        return f"{value / 1_000_000:.2f}M"
    if value >= 1_000:
        return f"{value / 1_000:.2f}K"
    return f"{value:.4f}".rstrip("0").rstrip(".")


def _safe_int(value: Any) -> int | None:
    try:
        if isinstance(value, str) and value.startswith("0x"):
            return int(value, 16)
        return int(value)
    except (TypeError, ValueError):
        return None
