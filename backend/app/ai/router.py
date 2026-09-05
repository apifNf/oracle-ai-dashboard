"""
backend/app/ai/router.py

ORACLE :: Dual-Model AI Router (Misi 3)

Hierarki:
  TIER 1 (Conversational) -> GPT-4o  : sapaan, tanya umum, istilah dasar crypto.
  TIER 2 (Quant Core)     -> FABLE 5 : Claude Sonnet/Opus reasoning engine.

Switch ke FABLE 5 bila SALAH SATU benar:
  * Trigger tombol "Execute Trade" atau "Copy-Trading Pilot"
    (flag execute_trade / copy_trading_pilot).
  * User meminta analisa mendalam, proyeksi struktur teknikal, atau analisa
    portofolio (heuristik kata kunci).
  * Ada parameter risiko / order eksekusi (risk_params terisi, atau kata kunci
    leverage / margin / TP / SL / entry / position size).

Router juga yang menyiapkan konteks anti-halusinasi (Pilar D): RSI/EMA riil dari
IndicatorEngine, plus konteks makro (RSS) & whale dari MarketIntelStore.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from app.ai.fable5 import SYNC_SENTINEL, Fable5Engine, Fable5Unavailable
from app.ai.tier1 import Tier1Conversational, Tier1Unavailable
from app.indicators.engine import IndicatorEngine

logger = logging.getLogger(__name__)

__all__ = ["AIModelRouter", "RouterRequest", "RouterResult"]

# Kata kunci pemicu TIER 2. Sengaja eksplisit supaya keputusan bisa diaudit.
_DEEP_ANALYSIS_HINTS = (
    "analisa mendalam", "analisis mendalam", "deep analysis", "deep dive",
    "proyeksi", "projection", "forecast", "struktur teknikal", "technical structure",
    "market structure", "elliott", "fibonacci", "orderblock", "order block",
    "liquidity sweep", "analisa portofolio", "analisis portofolio",
    "portfolio analysis", "rebalance", "rebalancing", "backtest", "scenario",
)
_ORDER_PARAM_HINTS = (
    "leverage", "margin", "take profit", "take-profit", "stop loss", "stop-loss",
    " tp ", " sl ", "position size", "position sizing", "risk per trade",
    "entry price", "lot size", "open long", "open short", "liquidate",
)

_KNOWN_SYMBOLS = {
    "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "LINK", "DOT",
    "POL", "MATIC", "UNI", "LTC", "BCH", "ETC", "FIL", "ICP", "VET", "NEAR",
    "OP", "ARB", "INJ", "RENDER", "RNDR", "ATOM", "IMX", "STX", "KAS", "TAO",
    "SUI", "SEI", "TIA", "HYPE", "PEPE", "WIF", "BONK",
}


@dataclass
class RouterRequest:
    prompt: str
    execute_trade: bool = False
    copy_trading_pilot: bool = False
    symbol: str | None = None
    risk_params: dict[str, Any] = field(default_factory=dict)
    history: list[dict[str, str]] = field(default_factory=list)


@dataclass
class RouterResult:
    tier: int
    model: str
    routed_because: str
    detected_symbol: str | None
    reply: str | None = None          # TIER 1
    decision: dict[str, Any] | None = None  # TIER 2 (JSON FABLE 5)
    metrics_used: str | None = None
    degraded: bool = False
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        payload = {
            "tier": self.tier,
            "model": self.model,
            "routed_because": self.routed_because,
            "detected_symbol": self.detected_symbol,
            "degraded": self.degraded,
        }
        if self.reply is not None:
            payload["reply"] = self.reply
        if self.decision is not None:
            payload["decision"] = self.decision
        if self.metrics_used is not None:
            payload["metrics_used"] = self.metrics_used
        if self.error is not None:
            payload["error"] = self.error
        return payload


class AIModelRouter:
    def __init__(
        self,
        *,
        store: Any | None = None,
        indicator_engine: IndicatorEngine | None = None,
        tier1: Tier1Conversational | None = None,
        fable5: Fable5Engine | None = None,
    ) -> None:
        self._store = store
        self._engine = indicator_engine or IndicatorEngine()
        self._owns_engine = indicator_engine is None
        self._tier1 = tier1 or Tier1Conversational()
        self._fable5 = fable5 or Fable5Engine()

    async def aclose(self) -> None:
        if self._owns_engine:
            await self._engine.aclose()

    # ---------------------- keputusan tier ------------------------- #

    def decide_tier(self, req: RouterRequest) -> tuple[int, str]:
        if req.execute_trade:
            return 2, "trigger:execute_trade"
        if req.copy_trading_pilot:
            return 2, "trigger:copy_trading_pilot"
        if req.risk_params:
            return 2, "risk_or_order_parameters_present"

        low = f" {req.prompt.lower()} "
        if any(h in low for h in _ORDER_PARAM_HINTS):
            return 2, "prompt_contains_order_parameters"
        if any(h in low for h in _DEEP_ANALYSIS_HINTS):
            return 2, "prompt_requests_deep_analysis_or_portfolio"
        return 1, "conversational_default"

    # ---------------------- eksekusi ------------------------------ #

    async def route(self, req: RouterRequest) -> RouterResult:
        tier, reason = self.decide_tier(req)
        symbol = self._detect_symbol(req)

        if tier == 1:
            return self._run_tier1(req, reason, symbol)
        return await self._run_tier2(req, reason, symbol)

    def _run_tier1(
        self, req: RouterRequest, reason: str, symbol: str | None
    ) -> RouterResult:
        result = RouterResult(
            tier=1,
            model=self._tier1._model,
            routed_because=reason,
            detected_symbol=symbol,
        )
        try:
            result.reply = self._tier1.reply(req.prompt, history=req.history)
        except Tier1Unavailable as exc:
            result.degraded = True
            result.error = str(exc)
            result.reply = (
                "TIER 1 (GPT-4o) tidak tersedia: " + str(exc) +
                " — set OPENAI_API_KEY dan pasang paket 'openai'."
            )
        return result

    async def _run_tier2(
        self, req: RouterRequest, reason: str, symbol: str | None
    ) -> RouterResult:
        result = RouterResult(
            tier=2,
            model=self._fable5._model,
            routed_because=reason,
            detected_symbol=symbol,
        )

        metrics_line = await self._live_metrics(symbol)
        result.metrics_used = metrics_line
        macro_ctx, whale_ctx = self._market_intel_context()

        trigger = None
        if req.execute_trade:
            trigger = "Execute Trade button"
        elif req.copy_trading_pilot:
            trigger = "Copy-Trading Pilot"

        try:
            result.decision = await self._fable5.analyze(
                req.prompt,
                symbol=symbol,
                metrics_line=metrics_line,
                macro_context=macro_ctx,
                whale_context=whale_ctx,
                risk_params=req.risk_params,
                trigger=trigger,
            )
        except Fable5Unavailable as exc:
            result.degraded = True
            result.error = str(exc)
            result.decision = {
                "execution_status": "DENIED",
                "decision_reasoning": (
                    "FABLE 5 quant core unavailable: " + str(exc) +
                    " — set ANTHROPIC_API_KEY and install the 'anthropic' package."
                ),
                "order_payload": {
                    "exchange_target": "N/A", "symbol": symbol or "UNKNOWN",
                    "action": "BUY_OPEN", "order_type": "MARKET",
                    "calculated_quantity_coin": 0.0, "allocated_margin_usdt": 0.0,
                    "applied_leverage": 1,
                    "risk_management": {"stop_loss_price": 0.0, "take_profit_targets": [0.0, 0.0]},
                },
                "risk_assessment": {
                    "systemic_volatility_score": "HIGH",
                    "applied_guardrail_caps": "Engine offline; no execution proposal generated.",
                },
            }
        return result

    # ---------------------- konteks ------------------------------ #

    async def _live_metrics(self, symbol: str | None) -> str:
        """Pilar D: RSI/EMA riil atau kalimat sinkronisasi wajib."""
        if not symbol:
            return SYNC_SENTINEL
        pair = f"{symbol}/USDT"
        try:
            data = await self._engine.analyze(pair, interval="1h")
        except Exception:
            logger.exception("IndicatorEngine.analyze gagal untuk %s.", pair)
            return SYNC_SENTINEL
        if not data or data.get("status") != "ok":
            return SYNC_SENTINEL
        rsi, ema20, ema50 = data.get("rsi"), data.get("ema20"), data.get("ema50")
        if rsi is None or ema20 is None or ema50 is None:
            return SYNC_SENTINEL
        return (
            f"{pair} ({data.get('interval', '1h')}, source={data.get('source')}): "
            f"price={data.get('price')}, RSI14={rsi}, EMA20={ema20}, EMA50={ema50}, "
            f"trend={data.get('trend')}, last_closed_at={data.get('last_closed_at')}."
        )

    def _market_intel_context(self) -> tuple[str, str]:
        if self._store is None:
            return ("No macro feed wired.", "No whale feed wired.")
        try:
            news = self._store.recent_news(6)
            chain = self._store.recent_onchain(6)
        except Exception:
            return ("Macro feed unavailable.", "Whale feed unavailable.")

        macro = "\n".join(
            f"- [{n.get('impact') or 'UNRATED'}] {n.get('source')}: {n.get('title')}"
            for n in news
        ) or "No macro headlines available."
        whale = "\n".join(
            f"- {c.get('amount_display')} {c.get('asset')} (~${c.get('amount_usd', 'n/a')}) "
            f"{c.get('from_address')} -> {c.get('to_address')} [{c.get('status')}]"
            for c in chain
        ) or "No qualifying whale transfers in the recent window."
        return (macro, whale)

    # ---------------------- util ------------------------------- #

    @staticmethod
    def _detect_symbol(req: RouterRequest) -> str | None:
        if req.symbol:
            return req.symbol.strip().upper().replace("/USDT", "").replace("USDT", "")
        tokens = re.findall(r"\b[A-Z]{2,6}\b", req.prompt.upper())
        for tok in tokens:
            if tok in _KNOWN_SYMBOLS:
                return tok
        return None
