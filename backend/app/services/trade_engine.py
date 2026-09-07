"""
backend/app/services/trade_engine.py

ORACLE :: TradeEngine (Tugas 2)

Human-in-the-Loop trade execution:
  - build_proposal(): hitung position size dari jarak Stop Loss, R/R, margin,
    lalu terapkan guardrail server-side (risk <= 2% equity, leverage <= 3x,
    notional <= cap). Klien / AI TIDAK dipercaya untuk sizing — selalu
    dihitung ulang di sini.
  - execute_paper(): simulasi. Catat posisi OPEN, alokasikan margin.
    PnL direalisasi ke saldo virtual saat close_paper().
  - execute_live(): Binance USDⓈ-M via ccxt. MATI secara default
    (settings.trade_live_enabled). Default ke testnet. Butuh confirm=true.

Semua angka dolar dalam USDT.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Literal

from app.core.config import settings

logger = logging.getLogger(__name__)

__all__ = ["TradeEngine", "TradeError", "LiveTradingDisabled"]

Side = Literal["BUY", "SELL"]


class TradeError(ValueError):
    """Parameter trade tidak valid / gagal guardrail."""


class LiveTradingDisabled(RuntimeError):
    """LIVE_BINANCE diminta tapi tidak diaktifkan."""


class TradeEngine:
    def __init__(self, indicator_engine: Any | None = None, scanner_hub: Any | None = None) -> None:
        self._engine = indicator_engine
        self._scanner_hub = scanner_hub
        self._ccxt_client: Any = None
        self._http: Any = None

    async def aclose(self) -> None:
        if self._http is not None:
            try:
                await self._http.aclose()
            except Exception:
                pass
            self._http = None

    # ---------------------- normalisasi simbol -------------------- #

    @staticmethod
    def _normalize_pair(symbol: str) -> str:
        """'SOLUSDT' / 'SOL' / 'SOL/USDT' / 'sol_usdt' -> 'SOL/USDT'."""
        s = (symbol or "").upper().replace("_", "/").strip()
        if "/" in s:
            base, _, quote = s.partition("/")
            return f"{base}/{quote or 'USDT'}"
        for q in ("USDT", "USDC", "BUSD", "USD"):
            if s.endswith(q) and len(s) > len(q):
                return f"{s[:-len(q)]}/{q}"
        return f"{s}/USDT"

    # ---------------------- harga acuan ----------------------------- #

    async def reference_price(self, symbol: str) -> float | None:
        """
        Harga live untuk entry MARKET / exit close.
        Urutan: ticker stream scanner -> ticker live Binance (langsung) ->
        IndicatorEngine klines.
        """
        pair = self._normalize_pair(symbol)            # "SOL/USDT"
        binance_symbol = pair.replace("/", "")         # "SOLUSDT"

        if self._scanner_hub is not None:
            try:
                tick = self._scanner_hub.stream.tickers.get(pair)
                if tick is not None and tick.price:
                    return float(tick.price)
            except Exception:
                pass

        price = await self._binance_ticker_price(binance_symbol)
        if price is not None:
            return price

        if self._engine is not None:
            try:
                data = await self._engine.analyze(pair, interval="1h")
                if data and data.get("status") == "ok" and data.get("price"):
                    return float(data["price"])
            except Exception:
                logger.exception("reference_price: analyze gagal untuk %s", pair)
        return None

    def _get_http(self) -> Any:
        import httpx

        if self._http is None:
            self._http = httpx.AsyncClient(
                timeout=httpx.Timeout(8.0),
                headers={"User-Agent": "ORACLE-Dashboard/1.0 (+trade engine)"},
            )
        return self._http

    async def _binance_ticker_price(self, binance_symbol: str) -> float | None:
        """GET /api/v3/ticker/price — harga pasar terkini, tanpa API key."""
        http = self._get_http()
        for base in ("https://api.binance.com", "https://data-api.binance.vision"):
            try:
                resp = await http.get(
                    f"{base}/api/v3/ticker/price", params={"symbol": binance_symbol}
                )
                if resp.status_code != 200:
                    continue
                price = float(resp.json().get("price", 0) or 0)
                if price > 0:
                    return price
            except Exception:
                continue
        return None

    async def reference_prices(self, symbols: list[str]) -> dict[str, float]:
        """
        Harga live batch untuk beberapa aset sekaligus (dipakai polling floating
        PnL di Journal). Kunci hasil = simbol Binance ('BTCUSDT').
        """
        norm: dict[str, str] = {}
        for s in symbols:
            pair = self._normalize_pair(s)
            norm[pair.replace("/", "")] = pair
        if not norm:
            return {}

        out: dict[str, float] = {}
        # 1. ticker stream scanner
        if self._scanner_hub is not None:
            for bsym, pair in norm.items():
                try:
                    tick = self._scanner_hub.stream.tickers.get(pair)
                    if tick is not None and tick.price:
                        out[bsym] = float(tick.price)
                except Exception:
                    pass

        # 2. batch Binance untuk sisanya
        missing = [b for b in norm if b not in out]
        if missing:
            import json as _json

            http = self._get_http()
            params = {"symbols": _json.dumps(missing, separators=(",", ":"))}
            for base in ("https://api.binance.com", "https://data-api.binance.vision"):
                try:
                    resp = await http.get(f"{base}/api/v3/ticker/price", params=params)
                    if resp.status_code != 200:
                        continue
                    rows = resp.json()
                    for row in rows if isinstance(rows, list) else []:
                        price = float(row.get("price", 0) or 0)
                        if price > 0:
                            out[str(row.get("symbol"))] = price
                    break
                except Exception:
                    continue

        # 3. fallback per-simbol untuk yang masih kosong
        for bsym in [b for b in norm if b not in out]:
            price = await self.reference_price(bsym)
            if price is not None:
                out[bsym] = price
        return out

    # ---------------------- proposal / sizing --------------------- #

    def build_proposal(
        self,
        *,
        symbol: str,
        side: Side,
        entry_price: float,
        stop_loss: float,
        take_profit: list[float],
        equity_usdt: float,
        risk_pct: float | None = None,
        leverage: int | None = None,
        order_type: str = "MARKET",
    ) -> dict[str, Any]:
        symbol = symbol.upper().replace("/", "")
        if not symbol.endswith("USDT"):
            symbol = f"{symbol}USDT"

        if side not in ("BUY", "SELL"):
            raise TradeError("side harus 'BUY' atau 'SELL'.")
        for name, val in (
            ("entry_price", entry_price),
            ("stop_loss", stop_loss),
            ("equity_usdt", equity_usdt),
        ):
            if val is None or float(val) <= 0:
                raise TradeError(f"{name} harus angka positif.")

        entry = float(entry_price)
        sl = float(stop_loss)
        equity = float(equity_usdt)

        # SL harus di sisi yang benar terhadap entry.
        if side == "BUY" and sl >= entry:
            raise TradeError("Untuk BUY, stop_loss harus DI BAWAH entry_price.")
        if side == "SELL" and sl <= entry:
            raise TradeError("Untuk SELL, stop_loss harus DI ATAS entry_price.")

        tps = [float(t) for t in (take_profit or []) if float(t) > 0]
        # TP harus di sisi profit.
        if side == "BUY":
            tps = [t for t in tps if t > entry]
        else:
            tps = [t for t in tps if t < entry]
        if not tps:
            # Default layered TP di 1R dan 2R kalau tidak diberi / tidak valid.
            r = abs(entry - sl)
            tps = (
                [round(entry + r, 8), round(entry + 2 * r, 8)]
                if side == "BUY"
                else [round(entry - r, 8), round(entry - 2 * r, 8)]
            )

        # ---- Guardrail: clamp risk & leverage ---- #
        req_risk = settings.trade_max_risk_pct if risk_pct is None else float(risk_pct)
        applied_risk_pct = max(0.05, min(req_risk, settings.trade_max_risk_pct))

        req_lev = settings.trade_leverage_cap if leverage is None else int(leverage)
        applied_leverage = max(1, min(req_lev, settings.trade_leverage_cap))

        caps: list[str] = []
        if risk_pct is not None and float(risk_pct) > settings.trade_max_risk_pct:
            caps.append(f"risk {float(risk_pct):.2f}%->{settings.trade_max_risk_pct:.2f}%")
        if leverage is not None and int(leverage) > settings.trade_leverage_cap:
            caps.append(f"leverage {int(leverage)}x->{settings.trade_leverage_cap}x")

        # ---- Position size dari jarak SL ---- #
        sl_distance = abs(entry - sl)
        sl_distance_pct = sl_distance / entry * 100.0
        risk_amount = equity * applied_risk_pct / 100.0
        qty = risk_amount / sl_distance                      # loss di SL == risk_amount
        notional = qty * entry
        margin = notional / applied_leverage

        # ---- Guardrail: notional cap ---- #
        if notional > settings.trade_max_notional_usdt:
            scale = settings.trade_max_notional_usdt / notional
            qty *= scale
            notional *= scale
            margin = notional / applied_leverage
            risk_amount = qty * sl_distance
            caps.append(
                f"notional capped at ${settings.trade_max_notional_usdt:,.0f} "
                f"(effective risk ~{risk_amount / equity * 100:.2f}%)"
            )

        # ---- Guardrail: margin tak boleh melebihi equity ---- #
        if margin > equity:
            raise TradeError(
                f"Margin (${margin:,.2f}) melebihi equity (${equity:,.2f}). "
                "Perlebar Stop Loss atau turunkan risk."
            )

        rr = [round(abs(tp - entry) / sl_distance, 2) for tp in tps]

        return {
            "symbol": symbol,
            "side": side,
            "order_type": order_type.upper() if order_type.upper() in ("MARKET", "LIMIT") else "MARKET",
            "entry_price": round(entry, 8),
            "stop_loss_price": round(sl, 8),
            "take_profit_targets": [round(t, 8) for t in tps],
            "sl_distance_pct": round(sl_distance_pct, 3),
            "position_size_coin": _round_qty(qty),
            "notional_usdt": round(notional, 2),
            "estimated_margin_usdt": round(margin, 2),
            "applied_leverage": applied_leverage,
            "applied_risk_pct": round(applied_risk_pct, 3),
            "risk_amount_usdt": round(risk_amount, 2),
            "risk_reward_ratio": rr,
            "primary_rr": rr[0] if rr else None,
            "equity_usdt": round(equity, 2),
            "guardrail_caps": "; ".join(caps) if caps else "none (within limits)",
        }

    # ---------------------- eksekusi PAPER ------------------------ #

    def execute_paper(self, proposal: dict[str, Any], account: dict[str, Any]) -> dict[str, Any]:
        margin = proposal["estimated_margin_usdt"]
        # Cek margin tersedia (balance - margin posisi terbuka lain sudah dihitung
        # pemanggil lewat account_summary; di sini cek sederhana vs balance).
        if margin > account["balance_usdt"]:
            raise TradeError(
                f"Margin ${margin:,.2f} > saldo virtual ${account['balance_usdt']:,.2f}."
            )
        return {
            "account_id": account["account_id"],
            "mode": "PAPER_TRADING",
            "symbol": proposal["symbol"],
            "side": proposal["side"],
            "order_type": proposal["order_type"],
            "entry_price": proposal["entry_price"],
            "filled_price": proposal["entry_price"],
            "stop_loss_price": proposal["stop_loss_price"],
            "take_profit_targets": proposal["take_profit_targets"],
            "position_size_coin": proposal["position_size_coin"],
            "notional_usdt": proposal["notional_usdt"],
            "allocated_margin_usdt": margin,
            "applied_leverage": proposal["applied_leverage"],
            "applied_risk_pct": proposal["applied_risk_pct"],
            "risk_reward_ratio": proposal["risk_reward_ratio"],
            "guardrail_caps": proposal["guardrail_caps"],
            "exchange_ref": None,
            "status": "OPEN",
        }

    @staticmethod
    def compute_pnl(trade: dict[str, Any], exit_price: float) -> float:
        qty = trade["position_size_coin"]
        entry = trade["filled_price"] or trade["entry_price"]
        if trade["side"] == "BUY":
            return (exit_price - entry) * qty
        return (entry - exit_price) * qty

    # ---------------------- eksekusi LIVE (gated) --------------- #

    async def execute_live(
        self,
        proposal: dict[str, Any],
        account: dict[str, Any],
        *,
        exchange_id: str = "binance",
        market_type: str = "spot",
        api_key: str | None,
        api_secret: str | None,
        api_password: str | None = None,
        dry_run: bool = True,
    ) -> dict[str, Any]:
        from app.api.execute_trade import (
            EXCHANGE_LABELS,
            ExchangeAdapterError,
            build_ccxt_exchange,
            place_order,
            to_ccxt_symbol,
            validate_route,
        )

        exchange_id = (exchange_id or settings.default_exchange_id).strip().lower()
        market_type = (market_type or settings.default_market_type).strip().lower()
        try:
            exchange_id, market_type = validate_route(exchange_id, market_type)
        except ExchangeAdapterError as exc:
            raise TradeError(str(exc)) from exc
        label = EXCHANGE_LABELS.get(exchange_id, exchange_id.upper())

        if not settings.trade_live_enabled:
            raise LiveTradingDisabled(
                f"LIVE trading ({label}) dinonaktifkan. Set TRADE_LIVE_ENABLED=true "
                "untuk mengaktifkan; setiap order tetap butuh confirm=true."
            )

        # Guardrail sudah diterapkan di build_proposal; ini pertahanan lapis dua.
        if proposal["applied_leverage"] > settings.trade_leverage_cap:
            raise TradeError("Leverage melebihi cap.")
        if proposal["notional_usdt"] > settings.trade_max_notional_usdt * 1.001:
            raise TradeError("Notional melebihi cap.")

        testnet = bool(settings.exchange_testnet or settings.binance_testnet)
        ccxt_symbol = to_ccxt_symbol(proposal["symbol"], market_type)

        base = {
            "account_id": account["account_id"],
            "mode": f"LIVE_{exchange_id.upper()}",
            "exchange_id": exchange_id,
            "exchange_label": label,
            "market_type": market_type,
            "symbol": proposal["symbol"],
            "ccxt_symbol": ccxt_symbol,
            "side": proposal["side"],
            "order_type": proposal["order_type"],
            "entry_price": proposal["entry_price"],
            "stop_loss_price": proposal["stop_loss_price"],
            "take_profit_targets": proposal["take_profit_targets"],
            "position_size_coin": proposal["position_size_coin"],
            "notional_usdt": proposal["notional_usdt"],
            "allocated_margin_usdt": proposal["estimated_margin_usdt"],
            "applied_leverage": proposal["applied_leverage"],
            "applied_risk_pct": proposal["applied_risk_pct"],
            "risk_reward_ratio": proposal["risk_reward_ratio"],
            "guardrail_caps": proposal["guardrail_caps"],
            "testnet": testnet,
        }

        if dry_run:
            return {
                **base,
                "status": "DRY_RUN",
                "filled_price": None,
                "exchange_ref": None,
                "note": f"dry_run=true — order TIDAK dikirim ke {label} ({market_type}).",
            }

        if not api_key or not api_secret:
            raise TradeError(
                f"Kredensial API {label} belum di-set (EXCHANGE_API_KEY / "
                f"EXCHANGE_API_SECRET, atau BINANCE_API_KEY untuk Binance)."
            )

        try:
            exchange = build_ccxt_exchange(
                exchange_id,
                market_type,
                api_key=api_key,
                api_secret=api_secret,
                api_password=api_password,
                testnet=testnet,
            )
            result = await asyncio.to_thread(
                place_order,
                exchange,
                symbol=ccxt_symbol,
                side=proposal["side"],
                order_type=proposal["order_type"],
                amount=proposal["position_size_coin"],
                price=proposal["entry_price"],
                leverage=proposal["applied_leverage"],
                market_type=market_type,
            )
        except ExchangeAdapterError as exc:
            raise TradeError(str(exc)) from exc

        return {
            **base,
            "status": "OPEN",
            "filled_price": result.get("filled_price") or proposal["entry_price"],
            "exchange_ref": result.get("id"),
        }


def _round_qty(qty: float) -> float:
    """Pembulatan kuantitas yang masuk akal (bukan pembulatan tick bursa)."""
    if qty >= 1000:
        return round(qty, 1)
    if qty >= 1:
        return round(qty, 3)
    if qty >= 0.001:
        return round(qty, 5)
    return round(qty, 8)
