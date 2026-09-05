"""
backend/app/api/routes/trade.py

ORACLE :: Trade Execution API (Tugas 2)

  POST /api/v1/trade/propose   -> hitung Trade Proposal Ticket (tanpa eksekusi)
  POST /api/v1/trade/execute   -> eksekusi PAPER_TRADING (default) / LIVE_BINANCE
  POST /api/v1/trade/close     -> tutup posisi paper, realisasi PnL ke saldo
  GET  /api/v1/trade/account   -> ringkasan akun (saldo virtual, margin, posisi)
  GET  /api/v1/trade/journal   -> jurnal trade (untuk menu Journal / Trade Ledger)
  GET  /api/v1/trade/config    -> guardrail & status LIVE (untuk UI)

Human-in-the-Loop: /execute WAJIB `confirm: true`. Guardrail (risk<=2%,
leverage<=3x, notional cap) dihitung ulang & ditegakkan server — parameter
sizing dari klien/AI tidak dipercaya.
"""

from __future__ import annotations

import asyncio
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.services.trade_engine import LiveTradingDisabled, TradeEngine, TradeError

router = APIRouter(prefix="/trade", tags=["Trade Execution"])


# --------------------------------------------------------------------------- #
# Skema
# --------------------------------------------------------------------------- #


class ProposeRequest(BaseModel):
    symbol: str
    side: Literal["BUY", "SELL"]
    stop_loss: float
    entry_price: float | None = None          # None -> harga acuan MARKET
    take_profit: list[float] = Field(default_factory=list)
    equity_usdt: float | None = None          # None -> saldo akun
    risk_pct: float | None = None
    leverage: int | None = None
    order_type: Literal["MARKET", "LIMIT"] = "MARKET"
    account_id: str = "default"


class ExecuteRequest(ProposeRequest):
    mode: Literal["PAPER_TRADING", "LIVE_BINANCE"] = "PAPER_TRADING"
    confirm: bool = False
    dry_run: bool = True                       # hanya relevan untuk LIVE_BINANCE


class CloseRequest(BaseModel):
    account_id: str = "default"
    trade_id: str
    exit_price: float | None = None


# --------------------------------------------------------------------------- #
# Helper
# --------------------------------------------------------------------------- #


def _store(request: Request) -> Any:
    st = getattr(request.app.state, "trade_store", None)
    if st is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "TradeStore belum diinisialisasi.")
    return st


def _engine(request: Request) -> TradeEngine:
    eng = getattr(request.app.state, "trade_engine", None)
    if eng is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "TradeEngine belum diinisialisasi.")
    return eng


async def _resolve_entry(engine: TradeEngine, body: ProposeRequest) -> float:
    if body.entry_price and body.entry_price > 0:
        return float(body.entry_price)
    price = await engine.reference_price(body.symbol)
    if price is None:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Harga acuan untuk {body.symbol} tidak tersedia; kirim entry_price eksplisit.",
        )
    return price


async def _build(request: Request, body: ProposeRequest) -> dict[str, Any]:
    engine = _engine(request)
    store = _store(request)
    account = await asyncio.to_thread(store.get_account, body.account_id)
    equity = body.equity_usdt if body.equity_usdt and body.equity_usdt > 0 else account["balance_usdt"]
    entry = await _resolve_entry(engine, body)
    try:
        return engine.build_proposal(
            symbol=body.symbol,
            side=body.side,
            entry_price=entry,
            stop_loss=body.stop_loss,
            take_profit=body.take_profit,
            equity_usdt=equity,
            risk_pct=body.risk_pct,
            leverage=body.leverage,
            order_type=body.order_type,
        )
    except TradeError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


# --------------------------------------------------------------------------- #
# Endpoint
# --------------------------------------------------------------------------- #


@router.get("/config")
async def trade_config() -> dict[str, Any]:
    return {
        "status": "ok",
        "paper_start_balance_usdt": settings.paper_start_balance_usdt,
        "max_risk_pct": settings.trade_max_risk_pct,
        "leverage_cap": settings.trade_leverage_cap,
        "max_notional_usdt": settings.trade_max_notional_usdt,
        "live_enabled": settings.trade_live_enabled,
        "binance_testnet": settings.binance_testnet,
    }


@router.get("/account")
async def trade_account(request: Request, account_id: str = "default") -> dict[str, Any]:
    summary = await asyncio.to_thread(_store(request).account_summary, account_id)
    return {"status": "ok", "account": summary}


@router.get("/journal")
async def trade_journal(request: Request, account_id: str = "default", limit: int = 100) -> dict[str, Any]:
    rows = await asyncio.to_thread(_store(request).list_trades, account_id, limit)
    return {"status": "ok", "count": len(rows), "trades": rows}


@router.post("/propose")
async def trade_propose(body: ProposeRequest, request: Request) -> dict[str, Any]:
    proposal = await _build(request, body)
    return {"status": "ok", "proposal": proposal}


@router.post("/execute")
async def trade_execute(body: ExecuteRequest, request: Request) -> dict[str, Any]:
    if not body.confirm:
        raise HTTPException(
            status.HTTP_428_PRECONDITION_REQUIRED,
            "confirm=true wajib (Human-in-the-Loop). Tinjau proposal lalu konfirmasi.",
        )

    store = _store(request)
    engine = _engine(request)
    proposal = await _build(request, body)
    account = await asyncio.to_thread(store.get_account, body.account_id)

    if body.mode == "PAPER_TRADING":
        try:
            trade = engine.execute_paper(proposal, account)
        except TradeError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
        record = await asyncio.to_thread(store.add_trade, trade)
        summary = await asyncio.to_thread(store.account_summary, body.account_id)
        return {"status": "ok", "mode": "PAPER_TRADING", "trade": record, "account": summary, "proposal": proposal}

    # ---- LIVE_BINANCE ---- #
    try:
        trade = await engine.execute_live(
            proposal,
            account,
            api_key=settings.binance_api_key,
            api_secret=settings.binance_api_secret,
            dry_run=body.dry_run,
        )
    except LiveTradingDisabled as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc))
    except TradeError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    except Exception as exc:  # error dari bursa
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Eksekusi bursa gagal: {type(exc).__name__}: {exc}")

    record = trade
    if trade.get("status") in ("OPEN", "DRY_RUN"):
        record = await asyncio.to_thread(store.add_trade, trade)
    return {"status": "ok", "mode": "LIVE_BINANCE", "trade": record, "proposal": proposal}


@router.post("/close")
async def trade_close(body: CloseRequest, request: Request) -> dict[str, Any]:
    store = _store(request)
    engine = _engine(request)
    trade = await asyncio.to_thread(store.get_trade, body.account_id, body.trade_id)
    if trade is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trade tidak ditemukan.")
    if trade["status"] != "OPEN":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Trade sudah {trade['status']}.")

    exit_price = body.exit_price
    if not exit_price or exit_price <= 0:
        exit_price = await engine.reference_price(trade["symbol"])
        if exit_price is None:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Harga keluar tidak tersedia; kirim exit_price.")

    pnl = engine.compute_pnl(trade, float(exit_price))
    closed = await asyncio.to_thread(store.close_trade, body.account_id, body.trade_id, round(float(exit_price), 8), pnl)
    summary = await asyncio.to_thread(store.account_summary, body.account_id)
    return {"status": "ok", "trade": closed, "realized_pnl_usdt": round(pnl, 2), "account": summary}
