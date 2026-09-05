"""
backend/app/ai/tier1.py

ORACLE :: TIER 1 — Conversational (Misi 3)

GPT-4o untuk pertanyaan umum, sapaan, dan penjelasan istilah dasar crypto.
Ringan, cepat, tanpa keluaran JSON eksekusi. Kalau pertanyaan berubah jadi
analisa mendalam / permintaan eksekusi, AIModelRouter yang mengalihkan ke
TIER 2 (FABLE 5) — bukan modul ini.
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
    "You are ORACLE, a crypto markets assistant. This is the conversational tier: "
    "answer greetings, general questions, and beginner-level crypto terminology "
    "clearly and briefly. Do NOT produce trade instructions, position sizing, order "
    "payloads, or price predictions — if the user needs deep technical analysis, "
    "portfolio review, or trade execution, tell them to use ORACLE's analysis / "
    "Execute Trade flow. Reply in the SAME LANGUAGE as the user."
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

    def reply(self, prompt: str, *, history: list[dict[str, str]] | None = None) -> str:
        client = self._get_client()
        messages = [{"role": "system", "content": _SYSTEM}]
        if history:
            messages.extend(history[-6:])
        messages.append({"role": "user", "content": prompt})
        try:
            response = client.chat.completions.create(
                model=self._model,
                messages=messages,
                max_tokens=700,
                temperature=0.3,
            )
        except Exception as exc:
            logger.exception("Panggilan GPT-4o (TIER 1) gagal.")
            raise Tier1Unavailable(f"OpenAI API error: {type(exc).__name__}") from exc
        return (response.choices[0].message.content or "").strip()
