"""
backend/app/services/billing_service.py

ORACLE :: BillingService (Fase Monetisasi)

Coinbase Commerce — buat charge $49 (USDC/USDT multi-chain), verifikasi webhook
(HMAC-SHA256 atas raw body), dan auto-provision FREE -> PRO.

Mock/sandbox mode: kalau COINBASE_COMMERCE_API_KEY belum di-set, charge dibuat
lokal (checkout_url menunjuk ke halaman mock frontend) sehingga alur upgrade
bisa diuji tanpa akun Coinbase. `POST /billing/mock-confirm` menyimulasikan
webhook `charge:confirmed` pada mode ini.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import uuid
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

__all__ = ["BillingService", "BillingError", "WebhookVerificationError"]

COINBASE_API = "https://api.commerce.coinbase.com"
COINBASE_API_VERSION = "2018-03-22"

# Aset & jaringan yang diterima (informasional untuk UI; Coinbase Commerce
# menangani pemilihan chain di halaman checkout).
ACCEPTED_ASSETS = ["USDC", "USDT"]
ACCEPTED_NETWORKS = ["base", "polygon", "ethereum", "solana"]


class BillingError(RuntimeError):
    pass


class WebhookVerificationError(RuntimeError):
    pass


class BillingService:
    def __init__(self, user_store: Any, billing_store: Any) -> None:
        self._users = user_store
        self._billing = billing_store
        self._api_key = settings.coinbase_commerce_api_key
        self._webhook_secret = settings.coinbase_commerce_webhook_secret
        self._http: httpx.AsyncClient | None = None

    @property
    def mock_mode(self) -> bool:
        return not bool(self._api_key)

    async def aclose(self) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    def _client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(
                base_url=COINBASE_API,
                timeout=httpx.Timeout(20.0),
                headers={
                    "X-CC-Api-Key": self._api_key or "",
                    "X-CC-Version": COINBASE_API_VERSION,
                    "Content-Type": "application/json",
                },
            )
        return self._http

    # ---------------------- create charge ------------------------ #

    async def create_charge(self, user_id: str, email: str | None) -> dict[str, Any]:
        uid = (user_id or "default").strip().lower() or "default"
        metadata = {"user_id": uid, "email": email or "", "plan": "PRO", "source": "oracle-dashboard"}

        if self.mock_mode:
            charge_id = f"mock_{uuid.uuid4().hex[:20]}"
            code = charge_id[-8:].upper()
            record = self._billing.create_charge({
                "charge_id": charge_id,
                "code": code,
                "user_id": uid,
                "email": email or "",
                "amount": settings.pro_price_usd,
                "currency": "USD",
                "provider": "mock",
                "checkout_url": f"{_frontend_origin()}/billing/mock?charge={charge_id}",
                "metadata": metadata,
            })
            logger.warning("Billing MOCK mode: charge %s dibuat untuk %s.", charge_id, uid)
            return {**record, "mock": True, "accepted_assets": ACCEPTED_ASSETS,
                    "accepted_networks": ACCEPTED_NETWORKS}

        payload = {
            "name": "ORACLE PRO — Monthly",
            "description": "Unlimited FABLE 5 prompts, scanner alerts, whale flow, autotrade engine.",
            "pricing_type": "fixed_price",
            "local_price": {"amount": settings.pro_price_usd, "currency": "USD"},
            "metadata": metadata,
            "redirect_url": settings.billing_redirect_url,
            "cancel_url": settings.billing_cancel_url,
        }
        try:
            resp = await self._client().post("/charges", json=payload)
            resp.raise_for_status()
            data = resp.json()["data"]
        except Exception as exc:
            logger.exception("Coinbase create charge gagal.")
            raise BillingError(f"Coinbase Commerce error: {type(exc).__name__}") from exc

        record = self._billing.create_charge({
            "charge_id": data["id"],
            "code": data.get("code"),
            "user_id": uid,
            "email": email or "",
            "amount": settings.pro_price_usd,
            "currency": "USD",
            "provider": "coinbase_commerce",
            "checkout_url": data.get("hosted_url"),
            "metadata": metadata,
        })
        return {**record, "mock": False, "accepted_assets": ACCEPTED_ASSETS,
                "accepted_networks": ACCEPTED_NETWORKS}

    # ---------------------- webhook ----------------------------- #

    def verify_signature(self, raw_body: bytes, signature: str | None) -> bool:
        """
        HMAC-SHA256 hex atas RAW BODY dengan COINBASE_COMMERCE_WEBHOOK_SECRET,
        dibandingkan constant-time. Di mock mode tanpa secret, verifikasi
        dilewati (khusus pengujian lokal) dan dicatat sebagai peringatan.
        """
        if not self._webhook_secret:
            if self.mock_mode:
                logger.warning("Webhook billing TANPA verifikasi (mock mode, secret kosong).")
                return True
            return False
        if not signature:
            return False
        expected = hmac.new(
            self._webhook_secret.encode("utf-8"), raw_body, hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(expected, signature.strip())

    async def handle_event(self, raw_body: bytes) -> dict[str, Any]:
        """
        Proses payload webhook. Return ringkasan aksi. Idempotent: event yang
        sama (event.id) tidak diproses dua kali.
        """
        try:
            payload = json.loads(raw_body)
        except json.JSONDecodeError as exc:
            raise BillingError("Body webhook bukan JSON valid.") from exc

        event = payload.get("event") or {}
        event_id = str(event.get("id") or "")
        event_type = str(event.get("type") or "")
        charge = event.get("data") or {}
        charge_id = str(charge.get("id") or "")

        if not event_id:
            raise BillingError("event.id tidak ada.")

        if self._billing.already_processed(event_id):
            return {"status": "duplicate", "event_id": event_id, "event_type": event_type}

        # Hanya event sukses yang memicu provisioning.
        if event_type not in ("charge:confirmed", "charge:resolved"):
            self._billing.mark_processed(event_id)
            return {"status": "ignored", "event_type": event_type, "charge_id": charge_id}

        metadata = charge.get("metadata") or {}
        stored = self._billing.get_charge(charge_id) if charge_id else None
        user_id = str(metadata.get("user_id") or (stored or {}).get("user_id") or "").strip().lower()
        if not user_id:
            self._billing.mark_processed(event_id)
            raise BillingError("Tidak bisa menentukan user_id dari metadata charge.")

        tx_hash = _extract_tx_hash(charge)
        result = self._provision(user_id, charge_id or f"evt_{event_id}", tx_hash)

        if charge_id:
            self._billing.update_charge(
                charge_id, {"status": "CONFIRMED", "tx_hash": tx_hash, "provisioned_user": user_id}
            )
        self._billing.mark_processed(event_id)

        logger.info(
            "Billing: %s -> PRO (charge=%s, tx=%s, event=%s).",
            user_id, charge_id, tx_hash, event_type,
        )
        return {
            "status": "provisioned",
            "event_type": event_type,
            "user_id": user_id,
            "charge_id": charge_id,
            "tx_hash": tx_hash,
            "account": result,
        }

    def _provision(self, user_id: str, charge_id: str, tx_hash: str | None) -> dict[str, Any]:
        return self._users.upgrade_to_pro(
            user_id,
            charge_id=charge_id,
            tx_hash=tx_hash,
            period_days=settings.pro_period_days,
        )

    # ---------------------- mock confirm ----------------------- #

    async def mock_confirm(self, charge_id: str) -> dict[str, Any]:
        if not self.mock_mode:
            raise BillingError("mock-confirm hanya tersedia saat billing mock mode.")
        stored = self._billing.get_charge(charge_id)
        if stored is None:
            raise BillingError("charge_id tidak ditemukan.")
        if stored.get("status") == "CONFIRMED":
            # Idempotent: charge ini sudah dibayar & di-provision.
            return {
                "status": "already_confirmed",
                "charge_id": charge_id,
                "user_id": stored.get("provisioned_user") or stored.get("user_id"),
            }
        fake_event = {
            "event": {
                "id": f"mockevt_{uuid.uuid4().hex[:16]}",
                "type": "charge:confirmed",
                "data": {
                    "id": charge_id,
                    "metadata": stored.get("metadata", {}),
                    "payments": [
                        {
                            "network": "base",
                            "transaction_id": f"0x{uuid.uuid4().hex}",
                            "value": {"crypto": {"amount": settings.pro_price_usd, "currency": "USDC"}},
                        }
                    ],
                },
            }
        }
        return await self.handle_event(json.dumps(fake_event).encode("utf-8"))


# --------------------------------------------------------------------------- #
# Util
# --------------------------------------------------------------------------- #


def _frontend_origin() -> str:
    return settings.billing_redirect_url.split("/ai-chat")[0] or "http://localhost:3001"


def _extract_tx_hash(charge: dict[str, Any]) -> str | None:
    payments = charge.get("payments") or []
    for p in payments:
        for key in ("transaction_id", "transaction_hash", "hash"):
            if p.get(key):
                return str(p[key])
    return None
