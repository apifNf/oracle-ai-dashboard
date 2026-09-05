"""
backend/app/ai/router.py

ORACLE :: Dual-Model AI Router (Misi 3 + evaluasi AI Chat)

Hierarki:
  TIER 1 (Conversational) -> GPT-4o  : sapaan, tanya cepat 1 aset, istilah dasar.
  TIER 2 (Quant Core)     -> FABLE 5 : Claude Sonnet/Opus. Dua sub-mode:
      - "execution" : keputusan order JSON (Misi 4). Dipicu tombol Execute
                      Trade / Copy-Trading Pilot, atau parameter risiko/order.
      - "analysis"  : analisa teknikal multi-dimensi (Markdown). Dipicu
                      perbandingan >= 2 aset atau permintaan analisa struktur
                      pasar mendalam.

Auto-inject metrik live (Pilar D anti-halusinasi): untuk SETIAP koin yang
disebut user, router menarik snapshot real-time dari backend —
  harga, perubahan 24J, RSI(14), status EMA20/EMA50 (bullish/bearish cross),
  support & resistance terdekat
— lalu menyuntikkannya ke system context sebelum prompt dikirim ke model.
Berlaku untuk TIER 1 maupun TIER 2.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field
from typing import Any

from app.ai.fable5 import SYNC_SENTINEL, Fable5Engine, Fable5Unavailable
from app.ai.tier1 import Tier1Conversational, Tier1Unavailable
from app.core.config import settings
from app.indicators.engine import IndicatorEngine

logger = logging.getLogger(__name__)

__all__ = ["AIModelRouter", "RouterRequest", "RouterResult"]

# Kata kunci pemicu — eksplisit supaya keputusan bisa diaudit.
_ORDER_PARAM_HINTS = (
    "leverage", "margin", "take profit", "take-profit", "stop loss", "stop-loss",
    " tp ", " sl ", "position size", "position sizing", "risk per trade",
    "entry price", "lot size", "open long", "open short", "liquidate",
    "buka long", "buka short",
)
_DEEP_ANALYSIS_HINTS = (
    "analisa mendalam", "analisis mendalam", "deep analysis", "deep dive",
    "proyeksi", "projection", "forecast", "struktur teknikal", "technical structure",
    "struktur pasar", "market structure", "elliott", "fibonacci", "orderblock",
    "order block", "liquidity sweep", "analisa portofolio", "analisis portofolio",
    "portfolio analysis", "rebalance", "rebalancing", "backtest", "skenario",
    "scenario",
)
_COMPARISON_HINTS = (
    " vs ", " vs. ", "versus", "bandingkan", "dibandingkan", "dibanding",
    "perbandingan", "compare", "comparison", "lebih baik", "lebih bagus",
    "mana yang lebih", "which is better",
)
# Permintaan setup / tiket trade -> analysis mode + blok proposal @@ORACLE_PROPOSAL@@.
_SETUP_HINTS = (
    "tiket trade", "trade ticket", "siapkan tiket", "buatkan tiket", "bikin tiket",
    "trade setup", "setup trade", "siapkan setup", "buatkan setup", "bikin setup",
    "trade plan", "rencana trade", "entry plan", "rencana entry", "trade idea",
    "ide trade", "siapkan entry", "setup entry", "kasih setup", "buatkan rencana",
)

# Kata umum ID/EN yang bertabrakan dengan ticker (mis. "mana", "ada", "atau").
# Token uppercase-asli di prompt tetap lolos; hanya jalur fallback (lowercase
# di-uppercase-kan) yang menyaring lewat set ini.
_AMBIGUOUS_WORDS = {
    "MANA", "ADA", "ATAU", "DAN", "INI", "ITU", "API", "APA", "AKU", "KAU",
    "DIA", "KITA", "KAMI", "NYA", "SIH", "DONG", "DEH", "KOK", "DARI", "PADA",
    "OLEH", "ATAS", "JIKA", "MAKA", "SAJA", "JUGA", "AKAN", "BISA", "MAU",
    "YANG", "UNTUK", "DENGAN", "TIDAK", "SUDAH", "BELUM", "HARI", "SAAT",
    "THE", "AND", "FOR", "ARE", "WAS", "YOU", "YOUR", "OUR", "ITS", "OUT",
    "TOP", "BUY", "SELL", "LOW", "HIGH", "ALL", "ANY", "NEW", "NOW", "PER",
    "VIA", "VS", "USD", "USDT",
}

_KNOWN_SYMBOLS = {
    "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "LINK", "DOT",
    "POL", "MATIC", "UNI", "LTC", "BCH", "ETC", "FIL", "ICP", "VET", "NEAR",
    "OP", "ARB", "INJ", "RENDER", "RNDR", "ATOM", "IMX", "STX", "KAS", "TAO",
    "SUI", "SEI", "TIA", "HYPE", "PEPE", "WIF", "BONK", "FLOKI", "SHIB", "TRX",
    "TON", "APT", "LDO", "AAVE", "MKR", "CRV", "ENA", "ONDO", "JUP", "PYTH",
    "ENS", "GRT", "SAND", "MANA", "AXS", "RUNE", "THETA", "EGLD", "FLOW",
    "XLM", "HBAR", "ALGO", "ZEC", "XMR", "DASH", "KAVA", "ROSE", "GALA",
}


@dataclass
class RouterRequest:
    prompt: str
    execute_trade: bool = False
    copy_trading_pilot: bool = False
    symbol: str | None = None
    risk_params: dict[str, Any] = field(default_factory=dict)
    history: list[dict[str, str]] = field(default_factory=list)
    user_id: str | None = None


@dataclass
class RouterResult:
    tier: int
    mode: str
    model: str
    routed_because: str
    detected_symbols: list[str]
    reply: str | None = None                  # TIER 1 & TIER 2 analysis
    decision: dict[str, Any] | None = None    # TIER 2 execution (JSON FABLE 5)
    metrics_used: str | None = None
    degraded: bool = False
    error: str | None = None
    user_tier: str = "free"
    quota: dict[str, Any] | None = None       # {limit, used, remaining}
    limit_reached: bool = False

    def as_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "tier": self.tier,
            "mode": self.mode,
            "model": self.model,
            "routed_because": self.routed_because,
            "detected_symbols": self.detected_symbols,
            "detected_symbol": self.detected_symbols[0] if self.detected_symbols else None,
            "degraded": self.degraded,
            "user_tier": self.user_tier,
            "limit_reached": self.limit_reached,
        }
        if self.quota is not None:
            payload["quota"] = self.quota
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
        scanner_hub: Any | None = None,
        user_store: Any | None = None,
        tier1: Tier1Conversational | None = None,
        fable5: Fable5Engine | None = None,
    ) -> None:
        self._store = store
        self._engine = indicator_engine or IndicatorEngine()
        self._owns_engine = indicator_engine is None
        self._scanner_hub = scanner_hub
        self._user_store = user_store
        self._tier1 = tier1 or Tier1Conversational()
        self._fable5 = fable5 or Fable5Engine()

    async def aclose(self) -> None:
        if self._owns_engine:
            await self._engine.aclose()

    # ---------------------- keputusan rute ------------------------- #

    def decide_route(self, req: RouterRequest) -> tuple[int, str, str]:
        """Return (tier, mode, reason). mode in {conversational, analysis, execution}."""
        if req.execute_trade:
            return 2, "execution", "trigger:execute_trade"
        if req.copy_trading_pilot:
            return 2, "execution", "trigger:copy_trading_pilot"
        if req.risk_params:
            return 2, "execution", "risk_or_order_parameters_present"

        low = f" {req.prompt.lower()} "
        if any(h in low for h in _ORDER_PARAM_HINTS):
            return 2, "execution", "prompt_contains_order_parameters"
        if any(h in low for h in _SETUP_HINTS):
            return 2, "analysis", "trade_setup_request"

        symbols = self.detect_symbols(req)
        if len(symbols) >= 2 or any(h in low for h in _COMPARISON_HINTS):
            return 2, "analysis", "asset_comparison_multi_dimensional"
        if any(h in low for h in _DEEP_ANALYSIS_HINTS):
            return 2, "analysis", "deep_market_structure_analysis"
        return 1, "conversational", "conversational_default"

    # Kompatibilitas: dipakai endpoint /route/preview.
    def decide_tier(self, req: RouterRequest) -> tuple[int, str]:
        tier, _mode, reason = self.decide_route(req)
        return tier, reason

    # ---------------------- eksekusi ------------------------------ #

    async def route(self, req: RouterRequest) -> RouterResult:
        tier, mode, reason = self.decide_route(req)
        symbols = self.detect_symbols(req)

        # --- Feature gating (Fase Monetisasi) --- #
        user_tier = "free"
        quota: dict[str, Any] | None = None
        if self._user_store is not None and req.user_id:
            gate = self._user_store.check_and_consume_prompt(req.user_id)
            user_tier = gate["tier"]
            quota = {
                "limit": gate["limit"],
                "used": gate["prompts_used_today"],
                "remaining": gate["prompts_remaining"],
            }
            if not gate["allowed"]:
                return RouterResult(
                    tier=0, mode="limit_reached", model="none",
                    routed_because="free_daily_prompt_limit_reached",
                    detected_symbols=symbols, user_tier="free", quota=quota,
                    limit_reached=True,
                    reply=(
                        f"Batas {gate['limit']} prompt/hari untuk FREE TIER sudah tercapai. "
                        "Upgrade ke ORACLE PRO ($49/bln, bayar USDC/USDT) untuk prompt tak "
                        "terbatas + prioritas model FABLE 5."
                    ),
                )

        snaps_raw = await asyncio.gather(
            *(self._market_snapshot(sym) for sym in symbols[:4])
        )
        snaps = [s for s in snaps_raw if s]
        covered = {s["coin"] for s in snaps}
        missing = [s for s in symbols[:4] if s not in covered]
        metrics_ctx = self._metrics_context(snaps, missing)
        macro_ctx, whale_ctx = self._market_intel_context()

        if tier == 1:
            result = await self._run_tier1(req, reason, symbols, metrics_ctx)
        else:
            result = await self._run_tier2(
                req, mode, reason, symbols, metrics_ctx, macro_ctx, whale_ctx, user_tier
            )
        result.user_tier = user_tier
        result.quota = quota
        return result

    async def _run_tier1(
        self,
        req: RouterRequest,
        reason: str,
        symbols: list[str],
        metrics_ctx: str,
    ) -> RouterResult:
        result = RouterResult(
            tier=1, mode="conversational", model=self._tier1._model,
            routed_because=reason, detected_symbols=symbols, metrics_used=metrics_ctx,
        )
        try:
            # SDK OpenAI sinkron -> jangan blokir event loop.
            result.reply = await asyncio.to_thread(
                self._tier1.reply,
                req.prompt, history=req.history, market_context=metrics_ctx,
            )
        except Tier1Unavailable as exc:
            result.degraded = True
            result.error = str(exc)
            result.reply = (
                "TIER 1 (GPT-4o) tidak tersedia: " + str(exc) +
                " — set OPENAI_API_KEY dan pasang paket 'openai'."
            )
        return result

    async def _run_tier2(
        self,
        req: RouterRequest,
        mode: str,
        reason: str,
        symbols: list[str],
        metrics_ctx: str,
        macro_ctx: str,
        whale_ctx: str,
        user_tier: str = "free",
    ) -> RouterResult:
        # PRO: prioritas model quant (Opus). FREE: model default (Sonnet).
        model_override = settings.fable5_model_pro if user_tier == "pro" else None
        result = RouterResult(
            tier=2, mode=mode, model=model_override or self._fable5._model,
            routed_because=reason, detected_symbols=symbols, metrics_used=metrics_ctx,
        )

        trigger = None
        if req.execute_trade:
            trigger = "Execute Trade button"
        elif req.copy_trading_pilot:
            trigger = "Copy-Trading Pilot"

        try:
            out = await self._fable5.analyze(
                req.prompt,
                mode=mode,
                model=model_override,
                symbol=symbols[0] if symbols else None,
                metrics_line=metrics_ctx,
                macro_context=macro_ctx,
                whale_context=whale_ctx,
                risk_params=req.risk_params,
                trigger=trigger,
            )
            if mode == "analysis":
                result.reply = out if isinstance(out, str) else str(out)
            else:
                result.decision = out if isinstance(out, dict) else None
        except Fable5Unavailable as exc:
            result.degraded = True
            result.error = str(exc)
            if mode == "analysis":
                result.reply = (
                    "FABLE 5 quant core tidak tersedia: " + str(exc) +
                    " — set ANTHROPIC_API_KEY dan pasang paket 'anthropic'."
                )
            else:
                result.decision = _engine_offline_decision(
                    symbols[0] if symbols else "UNKNOWN", str(exc)
                )
        return result

    # ---------------------- snapshot metrik ---------------------- #

    async def _market_snapshot(self, symbol: str) -> dict[str, Any] | None:
        """
        Snapshot real-time satu aset: harga, 24J %, RSI14, EMA20/50 cross,
        support & resistance terdekat. None kalau data tidak memadai.
        """
        pair = f"{symbol}/USDT"
        try:
            data = await self._engine.analyze(pair, interval="1h")
        except Exception:
            logger.exception("IndicatorEngine.analyze gagal untuk %s.", pair)
            return None
        if not data or data.get("status") != "ok":
            return None

        price = data.get("price")
        rsi = data.get("rsi")
        ema20 = data.get("ema20")
        ema50 = data.get("ema50")
        if price is None or rsi is None or ema20 is None or ema50 is None:
            return None

        candles = data.get("chartData") or []

        # 24h stats: utamakan ticker scanner (24hr Binance asli), fallback ke candle.
        change_24h = high_24h = low_24h = None
        tick = None
        if self._scanner_hub is not None:
            try:
                tick = self._scanner_hub.stream.tickers.get(pair)
            except Exception:
                tick = None
        if tick is not None and getattr(tick, "price", None) is not None:
            change_24h = getattr(tick, "change_24h", None)
            high_24h = getattr(tick, "high_24h", None)
            low_24h = getattr(tick, "low_24h", None)
        if change_24h is None and len(candles) >= 25:
            base = candles[-25].get("close")
            if base:
                change_24h = (candles[-1]["close"] - base) / base * 100.0

        support, resistance = self._sr_levels(candles, price, high_24h, low_24h)

        return {
            "coin": symbol,
            "pair": pair,
            "price": round(float(price), 8),
            "change_24h": round(change_24h, 2) if change_24h is not None else None,
            "rsi14": round(float(rsi), 2),
            "ema20": round(float(ema20), 8),
            "ema50": round(float(ema50), 8),
            "ema_cross": "bullish" if ema20 > ema50 else "bearish",
            "trend": data.get("trend"),
            "support": support,
            "resistance": resistance,
            "source": data.get("source"),
            "last_closed_at": data.get("last_closed_at"),
        }

    @staticmethod
    def _sr_levels(
        candles: list[dict[str, Any]],
        price: float,
        high_24h: float | None,
        low_24h: float | None,
    ) -> tuple[float | None, float | None]:
        """Support/Resistance terdekat dari extrema jendela candle terkini."""
        if not candles:
            return (
                round(low_24h, 8) if low_24h else None,
                round(high_24h, 8) if high_24h else None,
            )
        window = candles[-24:] if len(candles) >= 24 else candles
        try:
            win_hi = max(c["high"] for c in window)
            win_lo = min(c["low"] for c in window)
            all_hi = max(c["high"] for c in candles)
            all_lo = min(c["low"] for c in candles)
        except (KeyError, ValueError):
            return (None, None)

        if win_hi > price:
            resistance = win_hi
        elif all_hi > price:
            resistance = all_hi
        elif high_24h and high_24h > price:
            resistance = high_24h
        else:
            resistance = None  # harga di puncak lokal / blue sky

        if win_lo < price:
            support = win_lo
        elif all_lo < price:
            support = all_lo
        elif low_24h and low_24h < price:
            support = low_24h
        else:
            support = None

        return (
            round(support, 8) if support is not None else None,
            round(resistance, 8) if resistance is not None else None,
        )

    def _metrics_context(
        self, snaps: list[dict[str, Any]], missing: list[str]
    ) -> str:
        if not snaps and not missing:
            return "No coin mentioned; no live metrics injected."

        lines: list[str] = [
            "LIVE MARKET METRICS (real-time — ORACLE backend: Binance/Gate.io "
            "klines + 24h ticker). Use these numbers verbatim.",
            "",
        ]
        if snaps:
            lines.append(
                "| Aset | Harga | 24J % | RSI(14) | Tren (EMA20/50) | Support | Resistance |"
            )
            lines.append("|---|---|---|---|---|---|---|")
            for s in snaps:
                cross = (
                    "Bullish (EMA20>EMA50)"
                    if s["ema_cross"] == "bullish"
                    else "Bearish (EMA20<EMA50)"
                )
                lines.append(
                    f"| {s['coin']} | {_money(s['price'])} | {_pct(s['change_24h'])} "
                    f"| {s['rsi14']:.1f} | {cross} | {_money(s['support'])} "
                    f"| {_money(s['resistance'])} |"
                )
            lines.append("")
            lines.append("Per-asset detail:")
            for s in snaps:
                lines.append(
                    f"- {s['pair']}: price={s['price']}, chg24h="
                    f"{s['change_24h']}%, RSI14={s['rsi14']}, EMA20={s['ema20']}, "
                    f"EMA50={s['ema50']} ({s['ema_cross']} cross), trend={s['trend']}, "
                    f"support≈{s['support']}, resistance≈{s['resistance']}, "
                    f"source={s['source']}, last_closed={s['last_closed_at']}"
                )
        if missing:
            lines.append("")
            lines.append(
                "Coins requested but WITHOUT live metrics (do not fabricate values; "
                f"state they are under synchronization): {', '.join(missing)}. "
                f"Standard line: \"{SYNC_SENTINEL}\""
            )
        return "\n".join(lines)

    # ---------------------- konteks market intel ---------------- #

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
    def detect_symbols(req: RouterRequest) -> list[str]:
        out: list[str] = []
        if req.symbol:
            s = req.symbol.strip().upper().replace("/USDT", "").replace("USDT", "")
            if s:
                out.append(s)

        # Pass 1: token yang MEMANG ditulis uppercase di prompt asli -> ticker,
        # walau kebetulan kata umum (jarang, tapi eksplisit).
        for tok in re.findall(r"\b[A-Z]{2,6}\b", req.prompt):
            if tok in _KNOWN_SYMBOLS and tok not in out:
                out.append(tok)

        # Pass 2: fallback untuk prompt lowercase ("btc dan eth") — saring kata
        # ambigu supaya "mana"/"ada"/"atau" tidak dikira ticker.
        for tok in re.findall(r"\b[a-zA-Z]{2,6}\b", req.prompt):
            up = tok.upper()
            if up in _KNOWN_SYMBOLS and up not in _AMBIGUOUS_WORDS and up not in out:
                out.append(up)

        return out[:5]


# --------------------------------------------------------------------------- #
# Helper
# --------------------------------------------------------------------------- #


def _money(value: float | None) -> str:
    if value is None:
        return "—"
    if abs(value) >= 1000:
        return f"${value:,.2f}"
    if abs(value) >= 1:
        return f"${value:,.4f}"
    return f"${value:,.6f}"


def _pct(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{value:+.2f}%"


def _engine_offline_decision(symbol: str, reason: str) -> dict[str, Any]:
    return {
        "execution_status": "DENIED",
        "decision_reasoning": (
            "FABLE 5 quant core unavailable: " + reason +
            " — set ANTHROPIC_API_KEY and install the 'anthropic' package."
        ),
        "order_payload": {
            "exchange_target": "N/A", "symbol": symbol,
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
