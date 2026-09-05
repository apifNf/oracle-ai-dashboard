"""
backend/app/ai/tier1.py

ORACLE :: TIER 1 — Conversational, data-driven (Misi 3 + evaluasi AI Chat)

GPT-4o untuk sapaan, tanya cepat 1 aset, dan penjelasan istilah dasar.
Perbandingan aset & analisa struktur pasar mendalam dialihkan router ke
TIER 2 (FABLE 5).

Perubahan penting:
  - System prompt bersifat DATA-DRIVEN. Metrik live (harga, 24J %, RSI14,
    EMA20/50 cross, support/resistance) disuntikkan router lewat market_context
    dan model WAJIB menjawab berdasarkan angka itu, bukan pengetahuan umum.
  - Tidak ada penolakan kaku / disclaimer bertele-tele.
  - Tidak menyuruh user memakai alur "Execute Trade" (fitur itu belum ada di UI).
"""

from __future__ import annotations

import logging
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)

try:
    from openai import OpenAI  # type: ignore
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore

__all__ = ["Tier1Conversational", "Tier1Unavailable"]

_SYSTEM = (
    "You are ORACLE, a terminal-style crypto analyst. Answer ONLY from the "
    "injected LIVE METRICS — never from generic knowledge, never invent numbers.\n"
    "\n"
    "OUTPUT FORMAT (strict — keep the WHOLE reply under ~280 tokens, no preamble):\n"
    "1. A compact Markdown table: Aset | Harga | RSI(14) | EMA(20/50) | Support | Resistance\n"
    "2. A line `**Key Points:**` then EXACTLY 3 bullets:\n"
    "   - **Momentum:** <RSI zone + EMA trend, one line>\n"
    "   - **Whale/Volume Bias:** <from 24h % move + whale context, one line; \"n/a\" if none>\n"
    "   - **Invalidation:** <the price level that flips the read, one line>\n"
    "3. A line `**Bottom Line:**` then ONE neutral sentence.\n"
    "\n"
    "TRADE PROPOSAL BLOCK — if the user asked for a trade setup/ticket/plan, OR the "
    "read gives a clear directional bias with a sensible invalidation level, append "
    "this as the VERY LAST line (nothing after it), exact format:\n"
    "@@ORACLE_PROPOSAL@@ {\"asset\":\"<TICKER>\",\"side\":\"BUY\"|\"SELL\",\"entry\":<num>,\"sl\":<num>,\"tp\":[<num>,<num>],\"risk_rr\":[<num>,<num>]}\n"
    "entry = injected live price; sl just beyond nearest support (BUY) / resistance "
    "(SELL); tp = next 1-2 levels; risk_rr = |tp-entry|/|entry-sl|. Plain numbers, "
    "valid JSON on one line. No clean setup -> omit the block.\n"
    "\n"
    "RULES: bullet points only, no paragraphs, no encyclopedia explanations, no "
    "\"pasti\"/\"definitely\", no guaranteed targets, no \"Execute Trade\" mentions. "
    "If a coin's metrics are under synchronization, say so in one line and skip its "
    "row. For a pure definition question (\"apa itu RSI?\") reply in 1-2 sentences and "
    "skip the table. Reply in the SAME LANGUAGE as the user."
)


class Tier1Unavailable(RuntimeError):
    """TIER 1 tidak bisa dipanggil (SDK/kunci tidak ada)."""


class Tier1Conversational:
    def __init__(self, model: str | None = None, api_key: str | None = None) -> None:
        self._model = model or settings.tier1_model
        self._api_key = api_key or settings.openai_api_key
        self._client: Any = None

    def available(self) -> bool:
        return OpenAI is not None and bool(self._api_key)

    def _get_client(self) -> Any:
        if OpenAI is None:
            raise Tier1Unavailable("Paket 'openai' belum terpasang.")
        if not self._api_key:
            raise Tier1Unavailable("OPENAI_API_KEY belum di-set di environment.")
        if self._client is None:
            self._client = OpenAI(api_key=self._api_key)
        return self._client

    def reply(
        self,
        prompt: str,
        *,
        history: list[dict[str, str]] | None = None,
        market_context: str | None = None,
    ) -> str:
        client = self._get_client()
        messages: list[dict[str, str]] = [{"role": "system", "content": _SYSTEM}]
        if market_context:
            messages.append(
                {
                    "role": "system",
                    "content": "LIVE MARKET CONTEXT (inject, real-time):\n" + market_context,
                }
            )
        if history:
            messages.extend(history[-6:])
        messages.append({"role": "user", "content": prompt})
        try:
            response = client.chat.completions.create(
                model=self._model,
                messages=messages,
                max_tokens=480,   # kunci biaya output (Tugas 1) + blok proposal
                temperature=0.3,
            )
        except Exception as exc:
            logger.exception("Panggilan GPT-4o (TIER 1) gagal.")
            raise Tier1Unavailable(f"OpenAI API error: {type(exc).__name__}") from exc
        return (response.choices[0].message.content or "").strip()
