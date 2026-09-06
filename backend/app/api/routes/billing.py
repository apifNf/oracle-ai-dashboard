"""
backend/app/api/routes/billing.py

ORACLE :: Billing & Auto-Provisioning API (Fase Monetisasi)

  POST /api/v1/billing/create-charge  -> buat charge Coinbase ($49 USDC/USDT), balas checkout_url
  POST /api/v1/billing/webhook        -> terima charge:confirmed / charge:resolved, provision PRO
  POST /api/v1/billing/mock-confirm   -> (mock mode) simulasikan pembayaran sukses
  GET  /api/v1/billing/status         -> tier user + sisa kuota prompt (sync UI)
  GET  /api/v1/billing/config         -> harga, mock mode, aset/jaringan yang diterima
  GET  /api/v1/billing/charges        -> riwayat charge user
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request, status
from pydantic import BaseModel

from app.core.config import settings
from app.services.billing_service import ACCEPTED_ASSETS, ACCEPTED_NETWORKS, BillingError

router = APIRouter(prefix="/billing", tags=["Billing"])


class CreateChargeRequest(BaseModel):
    user_id: str = "default"
    email: str | None = None


class MockConfirmRequest(BaseModel):
    charge_id: str


def _svc(request: Request) -> Any:
    svc = getattr(request.app.state, "billing_service", None)
    if svc is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "BillingService belum diinisialisasi.")
    return svc


def _users(request: Request) -> Any:
    st = getattr(request.app.state, "user_store", None)
    if st is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "UserStore belum diinisialisasi.")
    return st


@router.get("/config")
async def billing_config(request: Request) -> dict[str, Any]:
    svc = _svc(request)
    return {
        "status": "ok",
        "price_usd": settings.pro_price_usd,
        "period_days": settings.pro_period_days,
        "free_prompt_daily_limit": settings.free_prompt_daily_limit,
        "mock_mode": svc.mock_mode,
        "accepted_assets": ACCEPTED_ASSETS,
        "accepted_networks": ACCEPTED_NETWORKS,
    }


@router.get("/status")
async def billing_status(request: Request, user_id: str = "default") -> dict[str, Any]:
    rec = await asyncio.to_thread(_users(request).get_user, user_id)
    return {
        "status": "ok",
        "user_id": rec["user_id"],
        "tier": rec["effective_tier"],
        "stored_tier": rec["tier"],
        "pro_expires_at": rec["pro_expires_at"],
        "pro_expired": rec["pro_expired"],
        "prompt_limit": rec["prompt_limit"],
        "prompts_used_today": rec["prompts_used_today"],
        "prompts_remaining": rec["prompts_remaining"],
    }


@router.get("/charges")
async def billing_charges(request: Request, user_id: str = "default", limit: int = 20) -> dict[str, Any]:
    store = getattr(request.app.state, "billing_store", None)
    if store is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "BillingStore belum diinisialisasi.")
    rows = await asyncio.to_thread(store.list_charges, user_id, limit)
    return {"status": "ok", "count": len(rows), "charges": rows}


@router.post("/create-charge")
async def create_charge(body: CreateChargeRequest, request: Request) -> dict[str, Any]:
    try:
        charge = await _svc(request).create_charge(body.user_id, body.email)
    except BillingError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))
    return {
        "status": "ok",
        "checkout_url": charge.get("checkout_url"),
        "charge_id": charge.get("charge_id"),
        "code": charge.get("code"),
        "amount_usd": charge.get("amount"),
        "state": charge.get("status"),
        "mock": charge.get("mock", False),
        "accepted_assets": charge.get("accepted_assets", ACCEPTED_ASSETS),
        "accepted_networks": charge.get("accepted_networks", ACCEPTED_NETWORKS),
    }


@router.post("/webhook", status_code=status.HTTP_200_OK)
async def webhook(
    request: Request,
    x_cc_webhook_signature: str | None = Header(default=None),
) -> dict[str, Any]:
    """
    Urutan: baca raw body -> verifikasi HMAC-SHA256 -> proses (idempotent).
    Selalu balas 200 untuk event valid/duplikat agar Coinbase berhenti retry;
    401 hanya untuk tanda tangan tidak valid.
    """
    svc = _svc(request)
    raw_body = await request.body()

    if not svc.verify_signature(raw_body, x_cc_webhook_signature):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid webhook signature.")

    try:
        result = await svc.handle_event(raw_body)
    except BillingError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    return result


@router.post("/mock-confirm")
async def mock_confirm(body: MockConfirmRequest, request: Request) -> dict[str, Any]:
    try:
        return await _svc(request).mock_confirm(body.charge_id)
    except BillingError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
