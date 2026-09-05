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
    "You are ORACLE, a data-driven crypto markets analyst wired to a live "
    "technical backend.\n"
    "\n"
    "RULES:\n"
    "- You are given LIVE METRICS for any coin the user names (price, 24h "
    "change, RSI(14), EMA20/EMA50 cross, nearest support & resistance). Build "
    "your answer on these real numbers — never answer from generic knowledge "
    "alone, and never invent values.\n"
    "- When one or more coins are in scope, START with a compact Markdown table "
    "with columns exactly: Aset | Harga | 24J % | RSI(14) | Tren (EMA20/50) | "
    "Support | Resistance — using the injected values verbatim. Then give 2-4 "
    "short quantitative observations that cite the actual numbers (e.g. "
    "\"ETH di atas EMA50 dengan RSI 54, sementara ZEC terkoreksi dengan RSI 41\").\n"
    "- Stay neutral and probabilistic. Never say price \"pasti\" / \"definitely\" "
    "goes up or down. No guaranteed targets. Let the numbers speak.\n"
    "- No rigid refusals or long disclaimers. Do NOT tell the user to use an "
    "\"Execute Trade\" / auto-trade / Copy-Trading flow — that feature does not "
    "exist in the UI. Just deliver the read.\n"
    "- If a coin's live metrics are marked as under synchronization, say so "
    "plainly for that coin and do not fabricate numbers.\n"
    "- For pure terminology questions (\"apa itu RSI?\") answer briefly and "
    "directly, no table needed.\n"
    "- Reply in the SAME LANGUAGE as the user. Be concise."
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
                max_tokens=900,
                temperature=0.3,
            )
        except Exception as exc:
            logger.exception("Panggilan GPT-4o (TIER 1) gagal.")
            raise Tier1Unavailable(f"OpenAI API error: {type(exc).__name__}") from exc
        return (response.choices[0].message.content or "").strip()
