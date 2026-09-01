"""
backend/app/api/v1/market_intel.py

ORACLE :: Market Intelligence API
  GET  /api/v1/market-intel/news     -> dibaca frontend
  GET  /api/v1/market-intel/onchain  -> dibaca frontend
  POST /api/v1/market-intel/webhooks/alchemy -> diterima dari Alchemy Notify

Verifikasi Alchemy (per dokumentasi resmi mereka):
  - Header: X-Alchemy-Signature
  - Isi: HMAC-SHA256 hex atas RAW BODY, tanpa prefix 'sha256=', tanpa timestamp
  - Kunci: signing key PER-WEBHOOK dari dashboard Notify, BUKAN Auth Token

Dua konsekuensi yang sering bikin verifikasi gagal atau palsu-lolos:
  1. HMAC wajib dihitung atas byte mentah. Body yang sudah di-parse lalu
     di-serialize ulang punya urutan key dan spasi berbeda -> tidak akan cocok.
  2. Contoh di dokumentasi Alchemy memakai `signature == digest`. Itu
     perbandingan non-constant-time yang bocor lewat timing. Pakai
     hmac.compare_digest.

Karena tanda tangan Alchemy tidak memuat timestamp, tidak ada perlindungan
replay bawaan. Deduplikasi delivery ID adalah satu-satunya pertahanan, dan
itu wajib, bukan opsional.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request, status

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/market-intel", tags=["market-intelligence"])

ALCHEMY_SIGNING_KEY = os.getenv("ALCHEMY_WEBHOOK_SIGNING_KEY", "")
MAX_WEBHOOK_BYTES = 1 * 1024 * 1024

REDIS_WEBHOOK_SEEN_PREFIX = "oracle:webhook:seen:"
WEBHOOK_DEDUPE_TTL = 24 * 3600
CHANNEL_ONCHAIN = "oracle:stream:onchain"

WHALE_THRESHOLD_USD = 1_000_000

# Defense in depth opsional; jangan dijadikan satu-satunya kontrol.
ALCHEMY_EGRESS_IPS = {"54.236.136.17", "34.237.24.169"}


# --------------------------------------------------------------------------- #
# Dependency helper — sesuaikan dengan cara app kamu menyimpan client
# --------------------------------------------------------------------------- #

def _redis(request: Request) -> Any:
    return request.app.state.redis


def _db(request: Request) -> Any:
    return request.app.state.supabase


def _envelope(
    items: list[dict[str, Any]] | None,
    state: str,
    error: dict[str, str] | None = None,
) -> dict[str, Any]:
    """
    Bentuk respons tunggal untuk semua endpoint baca.
    Frontend membaca `status`, bukan menebak dari panjang array.
    """
    return {
        "status": state,               # "ok" | "empty" | "degraded"
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
        result = (
            _db(request)
            .table("news_items")
            .select("id,source,title,url,image_url,published_at,impact")
            .order("published_at", desc=True)
            .limit(limit)
            .execute()
        )
        rows = result.data or []
    except Exception:
        logger.exception("Query berita gagal.")
        return _envelope(
            None, "degraded",
            {"code": "db_unavailable", "message": "Sumber berita tidak bisa dibaca."},
        )

    return _envelope(rows, "ok" if rows else "empty")


@router.get("/onchain")
async def get_onchain(request: Request, limit: int = 20) -> dict[str, Any]:
    limit = max(1, min(limit, 100))
    try:
        result = (
            _db(request)
            .table("onchain_events")
            .select(
                "id,event_type,network,asset,amount_display,"
                "from_address,to_address,tx_hash,block_number,status,received_at"
            )
            .order("received_at", desc=True)
            .limit(limit)
            .execute()
        )
        rows = result.data or []
    except Exception:
        logger.exception("Query on-chain gagal.")
        return _envelope(
            None, "degraded",
            {"code": "db_unavailable", "message": "Aliran on-chain tidak bisa dibaca."},
        )

    return _envelope(rows, "ok" if rows else "empty")


# --------------------------------------------------------------------------- #
# Webhook
# --------------------------------------------------------------------------- #


def verify_alchemy_signature(raw_body: bytes, signature: str | None) -> bool:
    """Constant-time. Return False untuk semua kondisi gagal, tanpa membedakan."""
    if not ALCHEMY_SIGNING_KEY or not signature:
        return False
    expected = hmac.new(
        ALCHEMY_SIGNING_KEY.encode("utf-8"), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature.strip())


@router.post("/webhooks/alchemy", status_code=status.HTTP_200_OK)
async def alchemy_webhook(
    request: Request,
    background: BackgroundTasks,
    x_alchemy_signature: str | None = Header(default=None),
) -> dict[str, Any]:
    """
    Urutan operasi di sini penting dan tidak boleh diubah:
      1. Baca raw body
      2. Verifikasi HMAC
      3. Baru parse JSON
      4. Dedupe
      5. Balas 200 secepatnya, kerja berat ke background

    Parse sebelum verifikasi berarti kamu memproses input yang belum
    terautentikasi. Balas lambat berarti Alchemy menganggap gagal dan
    mengirim ulang, yang melipatgandakan beban saat kamu sedang sibuk.
    """
    raw_body = await request.body()

    if len(raw_body) > MAX_WEBHOOK_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Payload terlalu besar.")

    if not verify_alchemy_signature(raw_body, x_alchemy_signature):
        # Jangan bocorkan alasan spesifik ke pengirim.
        logger.warning(
            "Webhook ditolak: tanda tangan tidak valid (client=%s).",
            request.client.host if request.client else "unknown",
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid signature.")

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Body bukan JSON valid.")

    delivery_id = str(payload.get("id") or "").strip()
    if not delivery_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Field 'id' tidak ada.")

    # ---- Dedupe: satu-satunya perlindungan replay yang kita punya -------- #
    seen_key = f"{REDIS_WEBHOOK_SEEN_PREFIX}{delivery_id}"
    try:
        first_time = await _redis(request).set(
            seen_key, "1", nx=True, ex=WEBHOOK_DEDUPE_TTL
        )
    except Exception:
        logger.warning("Dedupe Redis gagal; mengandalkan constraint UNIQUE di DB.")
        first_time = True

    if not first_time:
        # Balas 200 supaya Alchemy berhenti mengirim ulang.
        return {"status": "duplicate", "delivery_id": delivery_id}

    background.add_task(_process_event, request.app, payload, delivery_id)
    return {"status": "accepted", "delivery_id": delivery_id}


# --------------------------------------------------------------------------- #
# Pemrosesan background
# --------------------------------------------------------------------------- #


async def _process_event(app: Any, payload: dict[str, Any], delivery_id: str) -> None:
    try:
        rows = _flatten_alchemy(payload, delivery_id)
    except Exception:
        logger.exception("Payload webhook %s tidak bisa dinormalisasi.", delivery_id)
        return

    if not rows:
        return

    try:
        app.state.supabase.table("onchain_events").upsert(
            rows, on_conflict="provider,delivery_id", ignore_duplicates=True
        ).execute()
    except Exception:
        logger.exception("Gagal menyimpan event on-chain %s.", delivery_id)
        return

    try:
        for row in rows:
            await app.state.redis.publish(
                CHANNEL_ONCHAIN, json.dumps(row, default=str)
            )
    except Exception:
        logger.debug("Publish on-chain gagal (tidak fatal).")


def _flatten_alchemy(payload: dict[str, Any], delivery_id: str) -> list[dict[str, Any]]:
    """
    Ubah payload Alchemy menjadi baris tabel.

    Bentuk payload berbeda per tipe webhook (ADDRESS_ACTIVITY, MINED_TRANSACTION,
    NFT_ACTIVITY, GRAPHQL). Yang ditangani di sini ADDRESS_ACTIVITY; tipe lain
    disimpan mentah supaya tidak hilang, bukan dibuang diam-diam.
    """
    event_type = str(payload.get("type") or "UNKNOWN")
    network = (payload.get("event") or {}).get("network")
    created = payload.get("createdAt")

    base = {
        "provider": "alchemy",
        "delivery_id": delivery_id,
        "event_type": event_type,
        "network": network,
        "raw_payload": payload,
        "occurred_at": created,
    }

    activities = (payload.get("event") or {}).get("activity") or []
    if not activities:
        return [{**base, "status": "NORMAL"}]

    rows: list[dict[str, Any]] = []
    for index, activity in enumerate(activities[:50]):
        value = activity.get("value")
        asset = activity.get("asset") or "ETH"

        rows.append({
            **base,
            # Satu delivery bisa berisi banyak aktivitas; delivery_id harus
            # tetap unik per baris agar constraint UNIQUE tidak menolaknya.
            "delivery_id": f"{delivery_id}:{index}",
            "asset": asset,
            "amount_display": _format_amount(value, asset),
            "from_address": activity.get("fromAddress"),
            "to_address": activity.get("toAddress"),
            "tx_hash": activity.get("hash"),
            "block_number": _safe_int(activity.get("blockNum")),
            "status": _classify(value, asset),
        })

    return rows


def _classify(value: Any, asset: str) -> str:
    """
    Penanda ukuran, bukan sinyal beli/jual. Ambang berbasis jumlah token,
    bukan USD, karena harga tidak tersedia di jalur ini — jangan mengarang
    konversi yang tidak kamu punya.
    """
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return "NORMAL"

    thresholds = {"ETH": 500.0, "USDT": 1_000_000.0, "USDC": 1_000_000.0, "WBTC": 20.0}
    limit = thresholds.get(asset.upper())
    if limit is None:
        return "NORMAL"
    return "IMPORTANT" if amount >= limit else "NORMAL"


def _format_amount(value: Any, asset: str) -> str | None:
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return None
    if amount >= 1_000_000:
        return f"{amount / 1_000_000:.2f}M"
    if amount >= 1_000:
        return f"{amount / 1_000:.2f}K"
    return f"{amount:.4f}".rstrip("0").rstrip(".")


def _safe_int(value: Any) -> int | None:
    try:
        if isinstance(value, str) and value.startswith("0x"):
            return int(value, 16)
        return int(value)
    except (TypeError, ValueError):
        return None