"""
backend/app/ai/fable5.py

ORACLE :: FABLE 5 — Quant Core Brain (Misi 3 TIER 2 + Misi 4)

TIER 2 dari AI Router. Menjalankan Claude (Sonnet/Opus, dikonfigurasi lewat
settings.fable5_model) sebagai reasoning engine kuant "FABLE 5", dengan:

  - System instruction FABLE 5 yang di-inject apa adanya (FABLE5_SYSTEM_INSTRUCTION).
  - Enforcement output JSON: respons di-parse + divalidasi terhadap skema
    pydantic Fable5Decision. Kalau model membalas prosa / JSON tidak valid,
    satu kali retry korektif; kalau masih gagal, dikembalikan envelope
    DENIED terstruktur (bukan melempar 500 ke frontend).
  - Anti-halusinasi: RSI/EMA riil diambil dari IndicatorEngine backend dan
    disuntikkan ke konteks. Kalau kosong, kalimat wajib
    "Live metrics for this asset are currently under terminal synchronization."
    yang dipakai — bukan angka karangan.
  - Pilar A: konteks makro (RSS) + whale (>$500k) dari MarketIntelStore.

Butuh paket `anthropic` (tambahkan ke pyproject) dan ANTHROPIC_API_KEY.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from app.core.config import settings

logger = logging.getLogger(__name__)

try:
    import anthropic  # type: ignore
except Exception:  # pragma: no cover - defensive
    anthropic = None  # type: ignore

__all__ = [
    "FABLE5_SYSTEM_INSTRUCTION",
    "Fable5Decision",
    "Fable5Engine",
    "Fable5Unavailable",
]

SYNC_SENTINEL = "Live metrics for this asset are currently under terminal synchronization."


# --------------------------------------------------------------------------- #
# System instruction (Misi 4) — disimpan verbatim
# --------------------------------------------------------------------------- #

FABLE5_SYSTEM_INSTRUCTION = """You are the Senior Quantitative Strategist and Autonomous Risk Management Core of the ORACLE AI Platform (Version 2026.4.1 Enterprise Production). Integrated server-side into FastAPI.
Core Functions:
- Pillar A: Cross-Correlation Market Intelligence (Macro RSS + Whale data > $500k).
- Pillar B: Position Sizing (Max 2.0% equity allocation, Layered TP, Structural SL, Leverage max 2x-3x pada aset volatil). Output EXCLUSIVELY in raw JSON.
- Pillar C: Autonomous Guardrails (Cancel hanging limits, trailing stop on flash crashes).
- Pillar D: Anti-Hallucination. Ambil RSI/EMA riil dari backend. Jika data kosong, jawab: 'Live metrics for this asset are currently under terminal synchronization.'

Format JSON Output Wajib:
{
  "execution_status": "APPROVED" | "DENIED" | "OVERRIDE_TRIGGERED",
  "decision_reasoning": "string",
  "order_payload": {
    "exchange_target": "string",
    "symbol": "string",
    "action": "BUY_OPEN" | "SELL_OPEN" | "LIQUIDATE_ALL",
    "order_type": "MARKET" | "LIMIT",
    "calculated_quantity_coin": float,
    "allocated_margin_usdt": float,
    "applied_leverage": int,
    "risk_management": {
      "stop_loss_price": float,
      "take_profit_targets": [float, float]
    }
  },
  "risk_assessment": {
    "systemic_volatility_score": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
    "applied_guardrail_caps": "string"
  }
}"""

# Pengaman tambahan yang ditegakkan kode, bukan model. Ditempel ke system
# instruction supaya kontrak JSON tidak ambigu bagi model.
_JSON_ENFORCEMENT_RIDER = """
STRICT OUTPUT CONTRACT (enforced server-side):
- Respond with a SINGLE raw JSON object. No markdown fences, no prose before or after.
- Every field in the mandatory schema must be present. Numbers must be JSON numbers, not strings.
- `take_profit_targets` must be an array of exactly two numbers.
- If you cannot responsibly size a position (missing live metrics, insufficient user risk parameters, or the request is not an executable order), return `execution_status: "DENIED"` with `decision_reasoning` explaining why, and set numeric fields in `order_payload` to 0.
- `applied_leverage` is an integer between 1 and 3.
- This platform performs MANUAL execution only. Your JSON is a proposal for a human to review; never claim an order was placed.
"""


# --------------------------------------------------------------------------- #
# Skema output (Misi 4)
# --------------------------------------------------------------------------- #


class RiskManagement(BaseModel):
    stop_loss_price: float
    take_profit_targets: list[float] = Field(min_length=2, max_length=2)


class OrderPayload(BaseModel):
    exchange_target: str
    symbol: str
    action: Literal["BUY_OPEN", "SELL_OPEN", "LIQUIDATE_ALL"]
    order_type: Literal["MARKET", "LIMIT"]
    calculated_quantity_coin: float
    allocated_margin_usdt: float
    applied_leverage: int
    risk_management: RiskManagement


class RiskAssessment(BaseModel):
    systemic_volatility_score: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    applied_guardrail_caps: str


class Fable5Decision(BaseModel):
    execution_status: Literal["APPROVED", "DENIED", "OVERRIDE_TRIGGERED"]
    decision_reasoning: str
    order_payload: OrderPayload
    risk_assessment: RiskAssessment


class Fable5Unavailable(RuntimeError):
    """FABLE 5 tidak bisa dipanggil (SDK/kunci tidak ada)."""


# --------------------------------------------------------------------------- #
# Engine
# --------------------------------------------------------------------------- #


def _denied(reason: str, symbol: str = "UNKNOWN") -> dict[str, Any]:
    """Envelope DENIED terstruktur — dipakai saat model gagal patuh kontrak."""
    return {
        "execution_status": "DENIED",
        "decision_reasoning": reason,
        "order_payload": {
            "exchange_target": "N/A",
            "symbol": symbol,
            "action": "BUY_OPEN",
            "order_type": "MARKET",
            "calculated_quantity_coin": 0.0,
            "allocated_margin_usdt": 0.0,
            "applied_leverage": 1,
            "risk_management": {
                "stop_loss_price": 0.0,
                "take_profit_targets": [0.0, 0.0],
            },
        },
        "risk_assessment": {
            "systemic_volatility_score": "HIGH",
            "applied_guardrail_caps": "Output contract not satisfied; execution blocked by server.",
        },
    }


class Fable5Engine:
    def __init__(self, model: str | None = None, api_key: str | None = None) -> None:
        self._model = model or settings.fable5_model
        self._api_key = api_key or settings.anthropic_api_key
        self._client: Any = None

    def available(self) -> bool:
        return anthropic is not None and bool(self._api_key)

    def _get_client(self) -> Any:
        if anthropic is None:
            raise Fable5Unavailable(
                "Paket 'anthropic' belum terpasang. Tambahkan ke dependencies."
            )
        if not self._api_key:
            raise Fable5Unavailable("ANTHROPIC_API_KEY belum di-set di environment.")
        if self._client is None:
            self._client = anthropic.AsyncAnthropic(api_key=self._api_key)
        return self._client

    # ---------------------- API utama ------------------------------- #

    async def analyze(
        self,
        prompt: str,
        *,
        symbol: str | None = None,
        metrics_line: str | None = None,
        macro_context: str | None = None,
        whale_context: str | None = None,
        risk_params: dict[str, Any] | None = None,
        trigger: str | None = None,
    ) -> dict[str, Any]:
        """
        Kembalikan dict yang PASTI valid terhadap Fable5Decision (sudah
        divalidasi). Tidak melempar untuk kegagalan kepatuhan model —
        mengembalikan envelope DENIED.
        """
        client = self._get_client()

        user_block = self._build_user_block(
            prompt=prompt,
            symbol=symbol,
            metrics_line=metrics_line,
            macro_context=macro_context,
            whale_context=whale_context,
            risk_params=risk_params,
            trigger=trigger,
        )

        system = FABLE5_SYSTEM_INSTRUCTION + "\n" + _JSON_ENFORCEMENT_RIDER
        messages: list[dict[str, Any]] = [{"role": "user", "content": user_block}]

        raw = await self._call(client, system, messages)
        parsed = self._parse(raw)
        if parsed is not None:
            return parsed.model_dump()

        # Retry korektif satu kali: umpankan balik output yang salah.
        messages.append({"role": "assistant", "content": raw})
        messages.append(
            {
                "role": "user",
                "content": (
                    "Your previous response did not satisfy the strict JSON output "
                    "contract. Respond again with ONE raw JSON object that exactly "
                    "matches the mandatory schema — no markdown, no commentary."
                ),
            }
        )
        raw2 = await self._call(client, system, messages)
        parsed2 = self._parse(raw2)
        if parsed2 is not None:
            return parsed2.model_dump()

        logger.warning("FABLE 5 gagal mematuhi kontrak JSON setelah retry.")
        return _denied(
            "FABLE 5 reasoning engine returned a non-conforming payload twice; "
            "execution blocked by the server-side output guardrail.",
            symbol or "UNKNOWN",
        )

    # ---------------------- internal ------------------------------- #

    async def _call(self, client: Any, system: str, messages: list[dict[str, Any]]) -> str:
        try:
            response = await client.messages.create(
                model=self._model,
                max_tokens=4096,
                system=system,
                messages=messages,
                thinking={"type": "adaptive"},
            )
        except Exception as exc:  # SDK/HTTP error
            logger.exception("Panggilan Claude (FABLE 5) gagal.")
            raise Fable5Unavailable(f"Claude API error: {type(exc).__name__}") from exc

        return "".join(
            block.text for block in response.content if getattr(block, "type", None) == "text"
        ).strip()

    @staticmethod
    def _parse(raw: str) -> Fable5Decision | None:
        if not raw:
            return None
        candidate = raw.strip()
        # Buang pagar markdown kalau model tetap menambahkannya.
        if candidate.startswith("```"):
            candidate = re.sub(r"^```(?:json)?\s*|\s*```$", "", candidate, flags=re.DOTALL).strip()
        # Ambil objek JSON pertama yang seimbang.
        start = candidate.find("{")
        if start == -1:
            return None
        depth = 0
        end = -1
        for i in range(start, len(candidate)):
            ch = candidate[i]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        if end == -1:
            return None
        try:
            data = json.loads(candidate[start:end])
        except json.JSONDecodeError:
            return None
        try:
            return Fable5Decision.model_validate(data)
        except ValidationError as exc:
            logger.debug("Validasi Fable5Decision gagal: %s", exc)
            return None

    @staticmethod
    def _build_user_block(
        *,
        prompt: str,
        symbol: str | None,
        metrics_line: str | None,
        macro_context: str | None,
        whale_context: str | None,
        risk_params: dict[str, Any] | None,
        trigger: str | None,
    ) -> str:
        parts: list[str] = []
        if trigger:
            parts.append(f"[EXECUTION TRIGGER] {trigger}")
        parts.append(f"[TARGET SYMBOL] {symbol or 'not specified'}")

        # Pilar D — anti-halusinasi: metrik riil atau kalimat sinkronisasi.
        parts.append("[LIVE TECHNICAL METRICS — from ORACLE IndicatorEngine]")
        parts.append(metrics_line or SYNC_SENTINEL)

        parts.append("[PILLAR A — MACRO RSS CONTEXT]")
        parts.append(macro_context or "No macro headlines available.")
        parts.append("[PILLAR A — WHALE / ON-CHAIN CONTEXT (> $500k)]")
        parts.append(whale_context or "No qualifying whale transfers in the recent window.")

        parts.append("[USER RISK / ORDER PARAMETERS]")
        parts.append(json.dumps(risk_params or {}, ensure_ascii=False, sort_keys=True))

        parts.append("[USER REQUEST]")
        parts.append(prompt)

        parts.append(
            "\nProduce the mandatory JSON decision object now. Apply Pillar B position "
            "sizing (<= 2.0% equity, leverage 1-3, structural SL, layered TP). If live "
            "metrics are the synchronization sentinel or risk parameters are missing, "
            "return execution_status DENIED."
        )
        return "\n".join(parts)
