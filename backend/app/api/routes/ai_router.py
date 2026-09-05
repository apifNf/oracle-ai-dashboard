"""
backend/app/api/routes/ai_router.py

Endpoint Dual-Model AI Router (Misi 3 & 4).

  POST /api/v1/ai/route     -> jalankan router, balas TIER 1 (reply) atau
                               TIER 2 (decision JSON FABLE 5).
  POST /api/v1/ai/route/preview -> hanya keputusan tier, tanpa panggil model
                                   (murah, untuk debugging / UI).
  GET  /api/v1/ai/fable5/system -> system instruction FABLE 5 yang aktif.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.ai.fable5 import FABLE5_SYSTEM_INSTRUCTION
from app.ai.router import AIModelRouter, RouterRequest

router = APIRouter(prefix="/ai", tags=["AI Router"])


class AIRouteRequest(BaseModel):
    prompt: str
    execute_trade: bool = False
    copy_trading_pilot: bool = False
    symbol: str | None = None
    risk_params: dict[str, Any] = Field(default_factory=dict)
    history: list[dict[str, str]] = Field(default_factory=list)


def _router(request: Request) -> AIModelRouter:
    existing = getattr(request.app.state, "ai_router", None)
    if existing is not None:
        return existing
    # Fallback: buat instance sekali kalau lifespan belum menaruhnya.
    created = AIModelRouter(store=getattr(request.app.state, "market_intel_store", None))
    request.app.state.ai_router = created
    return created


def _to_router_request(body: AIRouteRequest) -> RouterRequest:
    return RouterRequest(
        prompt=body.prompt,
        execute_trade=body.execute_trade,
        copy_trading_pilot=body.copy_trading_pilot,
        symbol=body.symbol,
        risk_params=body.risk_params,
        history=body.history,
    )


@router.post("/route")
async def ai_route(body: AIRouteRequest, request: Request) -> dict[str, Any]:
    result = await _router(request).route(_to_router_request(body))
    return {"status": "ok", **result.as_dict()}


@router.post("/route/preview")
async def ai_route_preview(body: AIRouteRequest, request: Request) -> dict[str, Any]:
    tier, reason = _router(request).decide_tier(_to_router_request(body))
    return {
        "status": "ok",
        "tier": tier,
        "routed_because": reason,
        "model": "gpt-4o" if tier == 1 else "claude (FABLE 5)",
    }


@router.get("/fable5/system")
async def fable5_system() -> dict[str, Any]:
    return {"status": "ok", "system_instruction": FABLE5_SYSTEM_INSTRUCTION}
