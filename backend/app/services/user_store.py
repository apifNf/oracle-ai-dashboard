"""
backend/app/services/user_store.py

ORACLE :: UserStore (Fase Monetisasi)

Menyimpan tier akun (free / pro), masa berlaku Pro, referensi transaksi, dan
kuota prompt harian untuk feature gating AI Chat.

File JSON atomik — konsisten dengan MarketIntelStore / TradeStore. Deploy saat
ini tidak menjalankan Supabase/Postgres di backend; ganti read()/write() ke
Supabase (tabel `user_accounts`) tanpa menyentuh pemanggil.
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

__all__ = ["UserStore"]


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


class UserStore:
    def __init__(self, path: str, free_daily_limit: int = 3) -> None:
        self._path = Path(path)
        self._free_limit = int(free_daily_limit)
        self._lock = threading.RLock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            self._write({"users": {}})

    # ---------------------- IO ---------------------------------------- #

    def _read(self) -> dict[str, Any]:
        try:
            with self._path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (FileNotFoundError, json.JSONDecodeError):
            data = {"users": {}}
        data.setdefault("users", {})
        return data

    def _write(self, data: dict[str, Any]) -> None:
        tmp = self._path.with_suffix(f".{uuid.uuid4().hex}.tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, default=str)
        os.replace(tmp, self._path)

    # ---------------------- akun ------------------------------------- #

    @staticmethod
    def _norm(user_id: str) -> str:
        return (user_id or "default").strip().lower() or "default"

    def _blank(self, user_id: str) -> dict[str, Any]:
        return {
            "user_id": user_id,
            "tier": "free",
            "pro_expires_at": None,
            "charge_id": None,
            "tx_hash": None,
            "prompt_count_date": None,
            "prompt_count": 0,
            "created_at": _iso(_now()),
            "updated_at": _iso(_now()),
        }

    def get_user(self, user_id: str) -> dict[str, Any]:
        uid = self._norm(user_id)
        with self._lock:
            data = self._read()
            rec = data["users"].get(uid)
            if rec is None:
                rec = self._blank(uid)
                data["users"][uid] = rec
                self._write(data)
            return self._decorate(dict(rec))

    def _decorate(self, rec: dict[str, Any]) -> dict[str, Any]:
        """Tambahkan status terhitung: tier efektif (cek kedaluwarsa) + kuota."""
        effective = rec.get("tier", "free")
        exp = rec.get("pro_expires_at")
        expired = False
        if effective == "pro" and exp:
            try:
                if datetime.fromisoformat(exp) <= _now():
                    effective = "free"
                    expired = True
            except ValueError:
                pass

        used = self._used_today(rec)
        rec["effective_tier"] = effective
        rec["pro_expired"] = expired
        rec["prompt_limit"] = None if effective == "pro" else self._free_limit
        rec["prompts_used_today"] = used
        rec["prompts_remaining"] = (
            None if effective == "pro" else max(0, self._free_limit - used)
        )
        return rec

    @staticmethod
    def _today_key() -> str:
        return _now().strftime("%Y-%m-%d")

    def _used_today(self, rec: dict[str, Any]) -> int:
        return rec.get("prompt_count", 0) if rec.get("prompt_count_date") == self._today_key() else 0

    # ---------------------- gating prompt -------------------------- #

    def check_and_consume_prompt(self, user_id: str) -> dict[str, Any]:
        """
        Untuk FREE: cek batas harian; kalau masih ada jatah -> increment & allow.
        Untuk PRO: selalu allow, tanpa increment.
        Return: {allowed: bool, tier, prompts_used_today, prompts_remaining, limit}
        """
        uid = self._norm(user_id)
        with self._lock:
            data = self._read()
            rec = data["users"].get(uid) or self._blank(uid)
            data["users"][uid] = rec

            decorated = self._decorate(dict(rec))
            if decorated["effective_tier"] == "pro":
                return {
                    "allowed": True,
                    "tier": "pro",
                    "prompts_used_today": 0,
                    "prompts_remaining": None,
                    "limit": None,
                }

            today = self._today_key()
            used = rec.get("prompt_count", 0) if rec.get("prompt_count_date") == today else 0
            if used >= self._free_limit:
                return {
                    "allowed": False,
                    "tier": "free",
                    "prompts_used_today": used,
                    "prompts_remaining": 0,
                    "limit": self._free_limit,
                }

            rec["prompt_count_date"] = today
            rec["prompt_count"] = used + 1
            rec["updated_at"] = _iso(_now())
            self._write(data)
            return {
                "allowed": True,
                "tier": "free",
                "prompts_used_today": used + 1,
                "prompts_remaining": max(0, self._free_limit - (used + 1)),
                "limit": self._free_limit,
            }

    # ---------------------- provisioning -------------------------- #

    def upgrade_to_pro(
        self,
        user_id: str,
        *,
        charge_id: str,
        tx_hash: str | None,
        period_days: int = 30,
    ) -> dict[str, Any]:
        uid = self._norm(user_id)
        with self._lock:
            data = self._read()
            rec = data["users"].get(uid) or self._blank(uid)

            # Perpanjang dari waktu kedaluwarsa yang masih berlaku, bukan dari now.
            base = _now()
            cur = rec.get("pro_expires_at")
            if rec.get("tier") == "pro" and cur:
                try:
                    cur_dt = datetime.fromisoformat(cur)
                    if cur_dt > base:
                        base = cur_dt
                except ValueError:
                    pass

            rec["tier"] = "pro"
            rec["pro_expires_at"] = _iso(base + timedelta(days=period_days))
            rec["charge_id"] = charge_id
            rec["tx_hash"] = tx_hash
            rec["updated_at"] = _iso(_now())
            data["users"][uid] = rec
            self._write(data)
            return self._decorate(dict(rec))

    def set_tier(self, user_id: str, tier: str) -> dict[str, Any]:
        """Manual override (mis. downgrade admin / testing)."""
        uid = self._norm(user_id)
        with self._lock:
            data = self._read()
            rec = data["users"].get(uid) or self._blank(uid)
            rec["tier"] = "pro" if tier == "pro" else "free"
            if rec["tier"] == "free":
                rec["pro_expires_at"] = None
            rec["updated_at"] = _iso(_now())
            data["users"][uid] = rec
            self._write(data)
            return self._decorate(dict(rec))
