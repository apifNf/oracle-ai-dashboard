"""
backend/app/services/exchange_credentials.py

ORACLE :: ExchangeCredentialService
Satu-satunya tempat plaintext kredensial exchange boleh ada di memori.

Aturan yang ditegakkan file ini:
  - Plaintext tidak pernah masuk log, repr, exception message, atau response body.
  - Plaintext tidak pernah di-cache. Setiap pemakaian = dekripsi ulang.
  - Yang keluar ke API selalu bentuk termasker (empat karakter terakhir saja).
"""

from __future__ import annotations

import logging
import re
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from cryptography.exceptions import InvalidTag

from app.services.crypto_vault import CryptoVault, get_vault

logger = logging.getLogger(__name__)

__all__ = [
    "ExchangeCredentialService",
    "ExchangeCredentials",
    "CredentialNotFound",
    "CredentialIntegrityError",
    "install_secret_scrubber",
]

TABLE = "user_exchange_credentials"


class CredentialNotFound(LookupError):
    """Tidak ada kredensial aktif untuk (user, exchange)."""


class CredentialIntegrityError(RuntimeError):
    """Dekripsi gagal. Baris kemungkinan dimanipulasi atau kunci salah."""


# --------------------------------------------------------------------------- #
# Wadah plaintext
# --------------------------------------------------------------------------- #


@dataclass
class ExchangeCredentials:

    exchange_name: str
    api_key: str = field(repr=False)
    api_secret: str = field(repr=False)

    def __repr__(self) -> str:
        return f"<ExchangeCredentials {self.exchange_name} key=***{self.api_key[-4:]}>"

    __str__ = __repr__

    def masked(self) -> dict[str, str]:
        """Bentuk aman untuk response body dan log."""
        return {
            "exchange_name": self.exchange_name,
            "api_key_masked": mask(self.api_key),
            "api_secret_masked": "****",  # secret tidak pernah ditampilkan, bahkan sebagian
        }


def mask(value: str) -> str:
    if not value or len(value) <= 4:
        return "****"
    return f"****{value[-4:]}"


# --------------------------------------------------------------------------- #
# Service
# --------------------------------------------------------------------------- #


class ExchangeCredentialService:

    def __init__(self, supabase: Any, vault: CryptoVault | None = None) -> None:
        self._db = supabase
        self._vault = vault or get_vault()

    # ---------------------- tulis ---------------------------------------- #

    async def store(
        self,
        user_id: str,
        exchange_name: str,
        api_key: str,
        api_secret: str,
        label: str | None = None,
    ) -> dict[str, Any]:
        """
        Enkripsi lalu upsert. Return payload TERMASKER.
        """
        api_key = (api_key or "").strip()
        api_secret = (api_secret or "").strip()
        if not api_key or not api_secret:
            raise ValueError("api_key dan api_secret wajib diisi.")

        row = self._vault.encrypt_credential_pair(
            user_id=user_id,
            exchange_name=exchange_name,
            api_key=api_key,
            api_secret=api_secret,
        )
        if label:
            row["label"] = label[:120]

        # Kolom bytea: kirim sebagai hex Postgres lewat PostgREST.
        payload = {
            **row,
            "encrypted_api_key": _to_pg_bytea(row["encrypted_api_key"]),
            "nonce_key": _to_pg_bytea(row["nonce_key"]),
            "encrypted_api_secret": _to_pg_bytea(row["encrypted_api_secret"]),
            "nonce_secret": _to_pg_bytea(row["nonce_secret"]),
        }

        self._db.table(TABLE).upsert(
            payload, on_conflict="user_id,exchange_name"
        ).execute()

        # Log identitas operasi, bukan isinya.
        logger.info(
            "Kredensial tersimpan user=%s exchange=%s key=%s",
            user_id, row["exchange_name"], mask(api_key),
        )

        return {
            "exchange_name": row["exchange_name"],
            "api_key_masked": mask(api_key),
            "status": "stored",
        }

    async def delete(self, user_id: str, exchange_name: str) -> dict[str, Any]:
        self._db.table(TABLE).delete().eq("user_id", user_id).eq(
            "exchange_name", exchange_name.strip().upper()
        ).execute()
        logger.info("Kredensial dihapus user=%s exchange=%s", user_id, exchange_name)
        return {"exchange_name": exchange_name.strip().upper(), "status": "deleted"}

    # ---------------------- baca ----------------------------------------- #

    async def _load_row(self, user_id: str, exchange_name: str) -> dict[str, Any]:
        exchange = exchange_name.strip().upper()
        result = (
            self._db.table(TABLE)
            .select("*")
            .eq("user_id", user_id)
            .eq("exchange_name", exchange)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        if not rows:
            raise CredentialNotFound(
                f"Tidak ada kredensial aktif untuk exchange {exchange}."
            )
        return rows[0]

    @asynccontextmanager
    async def use(
        self, user_id: str, exchange_name: str
    ) -> AsyncIterator[ExchangeCredentials]:
        """
        Context manager: satu-satunya cara mengakses plaintext.

            async with cred_service.use(user_id, "BINANCE_FUTURES") as cred:
                await exchange_client.fetch_balance(cred.api_key, cred.api_secret)

        Plaintext dilepas begitu blok selesai. Jangan simpan objeknya ke
        variabel di luar blok, jangan taruh di cache, jangan kirim ke response.
        """
        row = await self._load_row(user_id, exchange_name)

        row = {
            **row,
            "encrypted_api_key": _from_pg_bytea(row["encrypted_api_key"]),
            "nonce_key": _from_pg_bytea(row["nonce_key"]),
            "encrypted_api_secret": _from_pg_bytea(row["encrypted_api_secret"]),
            "nonce_secret": _from_pg_bytea(row["nonce_secret"]),
        }

        try:
            plain = self._vault.decrypt_credential_pair(row)
        except InvalidTag as exc:
            # Ini sinyal serius: AAD tidak cocok. Entah baris dipindah antar
            # user, kolom ditukar, atau MASTER_KEY salah. Jangan disamarkan
            # jadi "kredensial tidak ditemukan".
            logger.critical(
                "INTEGRITAS GAGAL user=%s exchange=%s row_id=%s — "
                "kemungkinan manipulasi database atau MASTER_KEY salah.",
                user_id, exchange_name, row.get("id"),
            )
            raise CredentialIntegrityError(
                "Verifikasi kredensial gagal. Silakan sambungkan ulang exchange Anda."
            ) from exc

        cred = ExchangeCredentials(
            exchange_name=row["exchange_name"],
            api_key=plain["api_key"],
            api_secret=plain["api_secret"],
        )
        try:
            yield cred
        finally:
            # Python tidak menjamin penghapusan memori, tapi ini memutus
            # referensi supaya objeknya tidak ikut terbawa ke traceback.
            cred.api_key = ""
            cred.api_secret = ""

    async def list_connections(self, user_id: str) -> list[dict[str, Any]]:
        """Untuk UI. Tidak pernah menyentuh kolom ciphertext."""
        result = (
            self._db.table("v_user_exchange_status")
            .select("exchange_name,label,is_active,created_at,updated_at")
            .eq("user_id", user_id)
            .execute()
        )
        return result.data or []


# --------------------------------------------------------------------------- #
# Helper bytea
# --------------------------------------------------------------------------- #


def _to_pg_bytea(data: bytes) -> str:
    return "\\x" + data.hex()


def _from_pg_bytea(value: Any) -> bytes:
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value)
    if isinstance(value, str) and value.startswith("\\x"):
        return bytes.fromhex(value[2:])
    raise ValueError("Format bytea tidak dikenali.")


# --------------------------------------------------------------------------- #
# Jaring pengaman logging
# --------------------------------------------------------------------------- #

_SECRET_PATTERNS = [
    re.compile(r"\b[A-Za-z0-9]{32,}\b"),                       # API key/secret panjang
    re.compile(r"(?i)(api[_-]?(key|secret)\"?\s*[:=]\s*)\S+"),  # pasangan key: value
]


class _ScrubbingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            return True

        scrubbed = message
        for pattern in _SECRET_PATTERNS:
            scrubbed = pattern.sub("[REDACTED]", scrubbed)

        if scrubbed != message:
            record.msg = scrubbed
            record.args = ()
        return True


def install_secret_scrubber() -> None:
    """
    Panggil sekali saat startup. Ini lapisan terakhir, bukan izin untuk ceroboh:
    disiplin tidak me-log rahasia tetap tanggung jawab kode pemanggil.
    """
    root = logging.getLogger()
    if not any(isinstance(f, _ScrubbingFilter) for f in root.filters):
        root.addFilter(_ScrubbingFilter())
    for handler in root.handlers:
        if not any(isinstance(f, _ScrubbingFilter) for f in handler.filters):
            handler.addFilter(_ScrubbingFilter())