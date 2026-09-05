"""
backend/app/services/billing_store.py

ORACLE :: BillingStore (Fase Monetisasi)

Menyimpan charge Coinbase Commerce + set idempotency event webhook.
File JSON atomik. Ganti ke Supabase (tabel `billing_charges`) untuk produksi.
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

__all__ = ["BillingStore"]


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


class BillingStore:
    def __init__(self, path: str) -> None:
        self._path = Path(path)
        self._lock = threading.RLock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            self._write({"charges": {}, "processed_events": []})

    def _read(self) -> dict[str, Any]:
        try:
            with self._path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (FileNotFoundError, json.JSONDecodeError):
            data = {"charges": {}, "processed_events": []}
        data.setdefault("charges", {})
        data.setdefault("processed_events", [])
        return data

    def _write(self, data: dict[str, Any]) -> None:
        tmp = self._path.with_suffix(f".{uuid.uuid4().hex}.tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, default=str)
        os.replace(tmp, self._path)

    # ---------------------- charge ---------------------------------- #

    def create_charge(self, charge: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            data = self._read()
            record = {
                "status": "PENDING",
                "created_at": _now(),
                "updated_at": _now(),
                "tx_hash": None,
                **charge,
            }
            data["charges"][record["charge_id"]] = record
            self._write(data)
            return dict(record)

    def get_charge(self, charge_id: str) -> dict[str, Any] | None:
        with self._lock:
            data = self._read()
        c = data["charges"].get(charge_id)
        return dict(c) if c else None

    def update_charge(self, charge_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
        with self._lock:
            data = self._read()
            c = data["charges"].get(charge_id)
            if c is None:
                return None
            c.update(patch)
            c["updated_at"] = _now()
            self._write(data)
            return dict(c)

    def list_charges(self, user_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            data = self._read()
        rows = list(data["charges"].values())
        if user_id:
            uid = user_id.strip().lower()
            rows = [r for r in rows if str(r.get("user_id", "")).lower() == uid]
        rows.sort(key=lambda r: r.get("created_at", ""), reverse=True)
        return rows[:limit]

    # ---------------------- idempotency --------------------------- #

    def already_processed(self, event_id: str) -> bool:
        with self._lock:
            data = self._read()
            return event_id in data["processed_events"]

    def mark_processed(self, event_id: str) -> None:
        with self._lock:
            data = self._read()
            if event_id not in data["processed_events"]:
                data["processed_events"].append(event_id)
                # jaga ukuran wajar
                data["processed_events"] = data["processed_events"][-2000:]
                self._write(data)
