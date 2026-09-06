"""
backend/app/services/trade_store.py

ORACLE :: TradeStore (Tugas 2)

Penyimpanan akun (saldo virtual) + jurnal trade untuk Trade Execution Engine.

Backend deploy saat ini tidak menjalankan Supabase/Postgres dan paket kliennya
tidak terpasang, jadi penyimpanan default adalah FILE JSON atomik di disk
(persist antar-restart, nol infrastruktur, bisa langsung diuji).

Untuk produksi: ganti implementasi read()/write() ke Supabase (tabel
`paper_accounts` + `trade_journal`) tanpa menyentuh TradeEngine — semua akses
lewat method kelas ini.

Semua operasi read-modify-write dikunci (threading.Lock). Handler FastAPI
memanggilnya lewat asyncio.to_thread sehingga tidak memblokir event loop.
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

__all__ = ["TradeStore"]


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


class TradeStore:
    def __init__(self, path: str, paper_start_balance: float) -> None:
        self._path = Path(path)
        self._start_balance = float(paper_start_balance)
        self._lock = threading.RLock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            self._write({"accounts": {}, "trades": []})

    # ---------------------- IO ---------------------------------------- #

    def _read(self) -> dict[str, Any]:
        try:
            with self._path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (FileNotFoundError, json.JSONDecodeError):
            data = {"accounts": {}, "trades": []}
        data.setdefault("accounts", {})
        data.setdefault("trades", [])
        return data

    def _write(self, data: dict[str, Any]) -> None:
        tmp = self._path.with_suffix(f".{uuid.uuid4().hex}.tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, default=str)
        os.replace(tmp, self._path)  # atomik pada POSIX

    # ---------------------- akun ------------------------------------- #

    def get_account(self, account_id: str) -> dict[str, Any]:
        account_id = (account_id or "default").strip() or "default"
        with self._lock:
            data = self._read()
            acc = data["accounts"].get(account_id)
            if acc is None:
                acc = {
                    "account_id": account_id,
                    "balance_usdt": self._start_balance,
                    "starting_balance_usdt": self._start_balance,
                    "realized_pnl_usdt": 0.0,
                    "created_at": _now(),
                    "updated_at": _now(),
                }
                data["accounts"][account_id] = acc
                self._write(data)
            return dict(acc)

    def account_summary(self, account_id: str) -> dict[str, Any]:
        acc = self.get_account(account_id)
        trades = self.list_trades(account_id, limit=1000)
        open_trades = [t for t in trades if t["status"] == "OPEN"]
        allocated = sum(t["allocated_margin_usdt"] for t in open_trades)
        return {
            **acc,
            "available_margin_usdt": round(acc["balance_usdt"] - allocated, 2),
            "allocated_margin_usdt": round(allocated, 2),
            "open_positions": len(open_trades),
            "total_trades": len(trades),
        }

    def _touch_balance(self, data: dict[str, Any], account_id: str, delta: float) -> None:
        acc = data["accounts"][account_id]
        acc["balance_usdt"] = round(acc["balance_usdt"] + delta, 4)
        acc["realized_pnl_usdt"] = round(acc["realized_pnl_usdt"] + delta, 4)
        acc["updated_at"] = _now()

    # ---------------------- trades --------------------------------- #

    def list_trades(self, account_id: str, limit: int = 100) -> list[dict[str, Any]]:
        account_id = (account_id or "default").strip() or "default"
        with self._lock:
            data = self._read()
        rows = [t for t in data["trades"] if t.get("account_id") == account_id]
        rows.sort(key=lambda t: t.get("created_at", ""), reverse=True)
        return rows[: max(1, min(limit, 500))]

    def add_trade(self, trade: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            data = self._read()
            # pastikan akun ada
            if trade["account_id"] not in data["accounts"]:
                self.get_account(trade["account_id"])
                data = self._read()
            record = {
                "id": uuid.uuid4().hex[:16],
                "created_at": _now(),
                "updated_at": _now(),
                "status": "OPEN",
                **trade,
            }
            data["trades"].append(record)
            self._write(data)
            return dict(record)

    def get_trade(self, account_id: str, trade_id: str) -> dict[str, Any] | None:
        with self._lock:
            data = self._read()
        for t in data["trades"]:
            if t["id"] == trade_id and t.get("account_id") == account_id:
                return dict(t)
        return None

    def close_trade(
        self, account_id: str, trade_id: str, exit_price: float, pnl_usdt: float
    ) -> dict[str, Any] | None:
        with self._lock:
            data = self._read()
            for t in data["trades"]:
                if t["id"] == trade_id and t.get("account_id") == account_id:
                    if t["status"] != "OPEN":
                        return dict(t)
                    t["status"] = "CLOSED"
                    t["exit_price"] = exit_price
                    t["realized_pnl_usdt"] = round(pnl_usdt, 4)
                    t["closed_at"] = _now()
                    t["updated_at"] = _now()
                    if t.get("mode") == "PAPER_TRADING":
                        self._touch_balance(data, account_id, pnl_usdt)
                    self._write(data)
                    return dict(t)
        return None
