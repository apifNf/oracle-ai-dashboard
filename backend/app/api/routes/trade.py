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
    # "PAPER_TRADING" = simulasi; apa pun selain itu = LIVE (mis. "LIVE",
    # "LIVE_OKX"). Bursa & tipe pasar ditentukan Workspace Configuration user.
    mode: str = "PAPER_TRADING"
    confirm: bool = False
    dry_run: bool = True                       # hanya relevan untuk LIVE
    exchange_id: str | None = None             # binance|okx|bybit|mexc|indodax
    market_type: Literal["spot", "futures"] | None = None

    # --- Kredensial bursa milik USER (SaaS publik / non-custodial) --------- #
    # Dikirim browser user dari Settings → Workspace Configuration. Server TIDAK
    # menyimpannya: dipakai sekali untuk membangun klien CCXT lalu dibuang.
    # repr=False supaya tidak bocor lewat repr()/traceback framework.
    api_key: str | None = Field(default=None, repr=False)
    secret_key: str | None = Field(default=None, repr=False)
    passphrase: str | None = Field(default=None, repr=False)   # OKX/KuCoin


class CloseRequest(BaseModel):
    account_id: str = "default"
    trade_id: str
    exit_price: float | None = None


class ExchangeAccountRequest(BaseModel):
    # Snapshot READ-ONLY akun bursa user (saldo + posisi) untuk "Smart Journal".
    # Kredensial dikirim per-request dari browser dan tidak disimpan server —
    # sama seperti /execute.
    exchange_id: str | None = None
    market_type: Literal["spot", "futures"] | None = None
    api_key: str | None = Field(default=None, repr=False)
    secret_key: str | None = Field(default=None, repr=False)
    passphrase: str | None = Field(default=None, repr=False)


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
    from app.api.execute_trade import EXCHANGE_LABELS

    return {
        "status": "ok",
        "paper_start_balance_usdt": settings.paper_start_balance_usdt,
        "max_risk_pct": settings.trade_max_risk_pct,
        "leverage_cap": settings.trade_leverage_cap,
        "max_notional_usdt": settings.trade_max_notional_usdt,
        "live_enabled": settings.trade_live_enabled,
        "exchange_testnet": bool(settings.exchange_testnet or settings.binance_testnet),
        "binance_testnet": settings.binance_testnet,  # alias lama
        "default_exchange_id": settings.default_exchange_id,
        "default_market_type": settings.default_market_type,
        "supported_exchanges": [
            {"id": k, "label": v} for k, v in EXCHANGE_LABELS.items()
        ],
    }


@router.get("/account")
async def trade_account(request: Request, account_id: str = "default") -> dict[str, Any]:
    summary = await asyncio.to_thread(_store(request).account_summary, account_id)
    return {"status": "ok", "account": summary}


@router.get("/price")
async def trade_price(request: Request, symbol: str) -> dict[str, Any]:
    """Harga pasar live untuk satu simbol (dipakai frontend saat menutup posisi)."""
    price = await _engine(request).reference_price(symbol)
    if price is None:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"Harga live {symbol} tidak tersedia saat ini."
        )
    return {"status": "ok", "symbol": symbol.upper(), "price": price}


@router.get("/prices")
async def trade_prices(request: Request, symbols: str) -> dict[str, Any]:
    """
    Harga live batch. `symbols` = daftar dipisah koma (BTC,ETHUSDT,SOL/USDT).
    Dipakai polling floating / unrealized PnL di Journal (interval 3 detik).
    """
    syms = [s.strip() for s in symbols.split(",") if s.strip()][:50]
    prices = await _engine(request).reference_prices(syms)
    return {"status": "ok", "prices": prices}


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

    # ---- LIVE (bursa dinamis dari Workspace Configuration) ---- #
    from app.api.execute_trade import MissingCredentials, redact

    exchange_id = (body.exchange_id or settings.default_exchange_id).strip().lower()
    market_type = (body.market_type or settings.default_market_type).strip().lower()

    # Dry-run tidak menyentuh bursa sama sekali, jadi tidak perlu kunci. Order
    # sungguhan WAJIB punya kredensial — diprioritaskan milik user.
    creds = None
    if not body.dry_run:
        try:
            creds = _resolve_exchange_keys(exchange_id, body)
        except MissingCredentials as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))

    try:
        trade = await engine.execute_live(
            proposal,
            account,
            exchange_id=exchange_id,
            market_type=market_type,
            credentials=creds,
            dry_run=body.dry_run,
        )
    except LiveTradingDisabled as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc))
    except MissingCredentials as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    except TradeError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    except Exception as exc:  # error dari bursa
        # Bursa kadang menggemakan apiKey di pesan error — bersihkan sebelum
        # dikirim balik ke klien atau masuk log.
        detail = redact(exc, body.api_key, body.secret_key, body.passphrase)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"Eksekusi bursa gagal: {type(exc).__name__}: {detail}"
        )

    record = trade
    if trade.get("status") in ("OPEN", "DRY_RUN"):
        record = await asyncio.to_thread(store.add_trade, trade)
    return {"status": "ok", "mode": trade.get("mode", "LIVE"), "trade": record, "proposal": proposal}


def _resolve_exchange_keys(exchange_id: str, body: ExecuteRequest) -> Any:
    """
    SaaS publik non-custodial: kredensial dari payload user MENANG.

    `.env` server (EXCHANGE_API_KEY/SECRET, atau BINANCE_API_KEY untuk Binance)
    hanya fallback single-tenant, dan hanya kalau EXCHANGE_ALLOW_SERVER_KEYS
    masih true. Di deployment publik setel false supaya tidak ada user yang
    tanpa sadar mengirim order lewat akun bursa operator.
    """
    from app.api.execute_trade import resolve_credentials

    server_key = settings.exchange_api_key
    server_secret = settings.exchange_api_secret
    server_pass = settings.exchange_api_password
    if not (server_key and server_secret) and exchange_id == "binance":
        server_key, server_secret, server_pass = (
            settings.binance_api_key, settings.binance_api_secret, None
        )

    return resolve_credentials(
        exchange_id,
        user_key=body.api_key,
        user_secret=body.secret_key,
        user_passphrase=body.passphrase,
        server_key=server_key,
        server_secret=server_secret,
        server_passphrase=server_pass,
        allow_server_fallback=settings.exchange_allow_server_keys,
    )


@router.post("/validate-keys")
async def trade_validate_keys(body: ExchangeAccountRequest) -> dict[str, Any]:
    """
    API KEY PERMISSION INTERCEPTOR.

    Dipanggil Settings SEBELUM kunci disimpan ke localStorage. Membaca hak akses
    kunci langsung dari bursa dan MENOLAK (403) kalau izin penarikan/transfer
    masih aktif — kunci trade-only membatasi kerugian maksimum kalau browser
    user disusupi.

    Kode balikan:
      200 state="safe"    -> terbukti tanpa withdraw/transfer, boleh disimpan
      200 state="unknown" -> bursa tak bisa diverifikasi; UI wajib memperingatkan
      400 state="invalid" -> bursa menolak kunci (auth gagal)
      403 state="unsafe"  -> izin withdraw/transfer AKTIF, penyimpanan ditolak
    """
    from app.api.execute_trade import MissingCredentials, resolve_credentials
    from app.services.key_guard import inspect_api_key

    exchange_id = (body.exchange_id or settings.default_exchange_id).strip().lower()

    try:
        # allow_server_fallback=False: validasi HARUS menguji kunci milik user,
        # bukan diam-diam lulus memakai kunci .env operator.
        creds = resolve_credentials(
            exchange_id,
            user_key=body.api_key,
            user_secret=body.secret_key,
            user_passphrase=body.passphrase,
            allow_server_fallback=False,
        )
    except MissingCredentials as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))

    verdict = await asyncio.to_thread(
        inspect_api_key, exchange_id, credentials=creds
    )
    payload = {"exchange_id": exchange_id, **verdict.as_dict()}

    if verdict.state == "unsafe":
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=payload)
    if verdict.state == "invalid":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=payload)
    return payload


@router.post("/exchange-account")
async def trade_exchange_account(body: ExchangeAccountRequest) -> dict[str, Any]:
    """
    Saldo + posisi terbuka dari akun bursa milik user (READ-ONLY).

    Dipakai halaman Journal untuk "Smart Balance": kalau user sudah menyimpan
    kunci API-nya, tampilkan saldo stablecoin ASLI dari bursa; kalau belum,
    frontend jatuh ke "Virtual Balance $10,000".

    TIDAK di-gate oleh TRADE_LIVE_ENABLED (tidak menempatkan order). Kredensial
    user diprioritaskan; `.env` server hanya fallback bila
    EXCHANGE_ALLOW_SERVER_KEYS masih true.
    """
    from app.api.execute_trade import (
        MissingCredentials,
        fetch_exchange_account,
        redact,
        resolve_credentials,
    )

    exchange_id = (body.exchange_id or settings.default_exchange_id).strip().lower()
    market_type = (body.market_type or settings.default_market_type).strip().lower()

    server_key = settings.exchange_api_key
    server_secret = settings.exchange_api_secret
    server_pass = settings.exchange_api_password
    if not (server_key and server_secret) and exchange_id == "binance":
        server_key, server_secret, server_pass = (
            settings.binance_api_key, settings.binance_api_secret, None
        )

    try:
        creds = resolve_credentials(
            exchange_id,
            user_key=body.api_key,
            user_secret=body.secret_key,
            user_passphrase=body.passphrase,
            server_key=server_key,
            server_secret=server_secret,
            server_passphrase=server_pass,
            allow_server_fallback=settings.exchange_allow_server_keys,
        )
    except MissingCredentials as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))

    try:
        return await asyncio.to_thread(
            fetch_exchange_account, exchange_id, market_type, credentials=creds
        )
    except Exception as exc:  # jaring pengaman — helper sudah menelan errornya
        detail = redact(exc, body.api_key, body.secret_key, body.passphrase)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"Snapshot bursa gagal: {type(exc).__name__}: {detail}"
        )


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
    price_source = "client"
    if not exit_price or float(exit_price) <= 0:
        exit_price = await engine.reference_price(trade["symbol"])
        price_source = "live_market"
        if exit_price is None:
            # Jaring pengaman terakhir: tutup di harga masuk (PnL ~0) daripada
            # menggagalkan aksi user. Backend sudah mencoba ticker Binance live.
            exit_price = trade.get("filled_price") or trade["entry_price"]
            price_source = "entry_fallback"

    pnl = engine.compute_pnl(trade, float(exit_price))
    closed = await asyncio.to_thread(
        store.close_trade, body.account_id, body.trade_id, round(float(exit_price), 8), pnl
    )
    summary = await asyncio.to_thread(store.account_summary, body.account_id)
    return {
        "status": "ok",
        "trade": closed,
        "exit_price": round(float(exit_price), 8),
        "price_source": price_source,
        "realized_pnl_usdt": round(pnl, 2),
        "account": summary,
    }
