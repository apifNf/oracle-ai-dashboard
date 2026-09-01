"""
backend/app/services/crypto_vault.py

ORACLE :: CryptoVault
Enkripsi AES-256-GCM untuk kredensial exchange milik user.

Prinsip:
  - MASTER_KEY hidup HANYA di environment variable / secret manager.
    Tidak pernah disimpan di Supabase, tidak pernah di-commit, tidak pernah di-log.
  - Nonce 96-bit acak dibuat baru untuk SETIAP operasi enkripsi.
    Nonce tidak boleh dipakai ulang dengan kunci yang sama. Pernah.
  - AAD mengikat ciphertext ke (user_id, exchange_name, nama_field).
    Konsekuensinya: ciphertext yang dipindah ke baris user lain, ke exchange
    lain, atau ditukar antar kolom api_key <-> api_secret akan GAGAL dekripsi
    dengan cryptography.exceptions.InvalidTag.

Cara membuat MASTER_KEY (jalankan sekali, simpan hasilnya di secret manager):
    python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"

PERINGATAN: kalau MASTER_KEY hilang, seluruh kredensial di database menjadi
sampah permanen. Simpan salinan offline di password manager.
"""

from __future__ import annotations

import base64
import binascii
import os
import uuid
from functools import lru_cache
from typing import Any, Final

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

__all__ = [
    "CryptoVault",
    "get_vault",
    "VaultConfigError",
    "InvalidTag",
    "FIELD_API_KEY",
    "FIELD_API_SECRET",
]

# --------------------------------------------------------------------------- #
# Konstanta
# --------------------------------------------------------------------------- #

AES_KEY_BYTES: Final[int] = 32          # AES-256
NONCE_BYTES: Final[int] = 12            # 96-bit, ukuran standar & tercepat untuk GCM
GCM_TAG_BYTES: Final[int] = 16
CURRENT_KEY_VERSION: Final[int] = 1

AAD_SCHEMA: Final[str] = "oracle.vault.v1"
AAD_SEPARATOR: Final[str] = "|"

FIELD_API_KEY: Final[str] = "api_key"
FIELD_API_SECRET: Final[str] = "api_secret"
FIELD_GENERIC: Final[str] = "generic"

DEFAULT_ENV_VAR: Final[str] = "MASTER_KEY"
_MAX_PLAINTEXT_BYTES: Final[int] = 8 * 1024  # kredensial exchange tidak pernah sebesar ini


class VaultConfigError(RuntimeError):
    """Konfigurasi kunci master tidak valid. Fatal saat startup."""


# --------------------------------------------------------------------------- #
# CryptoVault
# --------------------------------------------------------------------------- #


class CryptoVault:
    """Envelope AES-256-GCM dengan AAD terikat konteks baris database."""

    __slots__ = ("_aesgcm", "_key_version")

    # ---------------------- konstruksi ----------------------------------- #

    def __init__(self, master_key: bytes, key_version: int = CURRENT_KEY_VERSION) -> None:
        if not isinstance(master_key, (bytes, bytearray)):
            raise VaultConfigError("master_key harus bertipe bytes.")

        if len(master_key) != AES_KEY_BYTES:
            raise VaultConfigError(
                f"MASTER_KEY harus tepat {AES_KEY_BYTES} byte setelah di-decode "
                f"(AES-256), ditemukan {len(master_key)} byte."
            )

        if master_key == bytes(AES_KEY_BYTES):
            raise VaultConfigError("MASTER_KEY tidak boleh berisi semua byte nol.")

        self._aesgcm = AESGCM(bytes(master_key))
        self._key_version = int(key_version)

    @classmethod
    def from_env(cls, var_name: str = DEFAULT_ENV_VAR) -> "CryptoVault":
        """Muat kunci dari environment variable. Menerima base64 atau hex."""
        raw = os.getenv(var_name)

        if raw is None:
            raise VaultConfigError(
                f"Environment variable '{var_name}' tidak ditemukan. "
                f"Generate dengan: "
                f"python -c \"import os,base64;print(base64.b64encode(os.urandom(32)).decode())\""
            )

        raw = raw.strip().strip('"').strip("'")
        if not raw:
            raise VaultConfigError(f"Environment variable '{var_name}' kosong.")

        return cls(cls._decode_master_key(raw, var_name))

    @staticmethod
    def _decode_master_key(raw: str, var_name: str) -> bytes:
        """Decode string kunci. Urutan coba: hex (64 char) -> base64 -> base64url."""
        if len(raw) == AES_KEY_BYTES * 2:
            try:
                return bytes.fromhex(raw)
            except ValueError:
                pass

        for decoder in (base64.b64decode, base64.urlsafe_b64decode):
            try:
                decoded = decoder(raw, validate=True)  # type: ignore[call-arg]
            except (binascii.Error, ValueError):
                continue
            if len(decoded) == AES_KEY_BYTES:
                return decoded

        raise VaultConfigError(
            f"'{var_name}' tidak bisa di-decode menjadi {AES_KEY_BYTES} byte. "
            f"Gunakan base64 dari 32 byte acak (panjang string 44 karakter) "
            f"atau hex 64 karakter."
        )

    # ---------------------- AAD ------------------------------------------ #

    @staticmethod
    def _normalize_user_id(user_id: str) -> str:
        """
        Normalisasi UUID ke bentuk kanonik lowercase bertanda hubung.

        Wajib: tanpa ini, '4A1B...' dan '4a1b...' menghasilkan AAD berbeda
        sehingga dekripsi gagal padahal datanya sah.
        """
        if isinstance(user_id, uuid.UUID):
            return str(user_id)

        if not isinstance(user_id, str) or not user_id.strip():
            raise ValueError("user_id wajib berupa string UUID yang tidak kosong.")

        try:
            return str(uuid.UUID(user_id.strip()))
        except (ValueError, AttributeError, TypeError) as exc:
            raise ValueError(f"user_id bukan UUID yang valid: {user_id!r}") from exc

    @classmethod
    def _build_aad(cls, user_id: str, exchange_name: str, field: str) -> bytes:
        """
        Susun Associated Authenticated Data.

        Format: oracle.vault.v1|<uuid>|<EXCHANGE>|<field>

        AAD tidak dienkripsi, tetapi ikut diautentikasi oleh tag GCM. Kalau
        salah satu komponennya berubah saat dekripsi, hasilnya InvalidTag.
        """
        normalized_user = cls._normalize_user_id(user_id)

        exchange = (exchange_name or "").strip().upper()
        if not exchange:
            raise ValueError("exchange_name wajib diisi.")

        field_name = (field or "").strip().lower()
        if not field_name:
            raise ValueError("field wajib diisi.")

        for part in (exchange, field_name):
            if AAD_SEPARATOR in part:
                raise ValueError(
                    f"Karakter '{AAD_SEPARATOR}' dilarang di komponen AAD: {part!r}"
                )

        return AAD_SEPARATOR.join(
            (AAD_SCHEMA, normalized_user, exchange, field_name)
        ).encode("utf-8")

    # ---------------------- API inti ------------------------------------- #

    def encrypt_credentials(
        self,
        user_id: str,
        raw_text: str,
        *,
        exchange_name: str = "GLOBAL",
        field: str = FIELD_GENERIC,
    ) -> dict[str, Any]:
        """
        Enkripsi satu string rahasia.

        Return dict siap-INSERT:
            {
                "ciphertext": bytes,   -> kolom bytea
                "nonce": bytes,        -> kolom bytea (12 byte)
                "key_version": int,
                "ciphertext_b64": str, -> kalau kolom kamu TEXT, bukan BYTEA
                "nonce_b64": str,
            }
        """
        if not isinstance(raw_text, str):
            raise ValueError("raw_text wajib berupa string.")

        plaintext = raw_text.strip().encode("utf-8")
        if not plaintext:
            raise ValueError("raw_text tidak boleh kosong.")
        if len(plaintext) > _MAX_PLAINTEXT_BYTES:
            raise ValueError(
                f"raw_text melebihi batas {_MAX_PLAINTEXT_BYTES} byte. "
                f"Kredensial exchange tidak pernah sepanjang ini."
            )

        aad = self._build_aad(user_id, exchange_name, field)

        # Nonce acak baru untuk setiap panggilan.
        # Catatan: AESGCM.generate_nonce() TIDAK ADA di pustaka cryptography.
        nonce = os.urandom(NONCE_BYTES)

        ciphertext = self._aesgcm.encrypt(nonce, plaintext, aad)

        return {
            "ciphertext": ciphertext,
            "nonce": nonce,
            "key_version": self._key_version,
            "ciphertext_b64": base64.b64encode(ciphertext).decode("ascii"),
            "nonce_b64": base64.b64encode(nonce).decode("ascii"),
        }

    def decrypt_credentials(
        self,
        user_id: str,
        ciphertext: bytes,
        nonce: bytes,
        *,
        exchange_name: str = "GLOBAL",
        field: str = FIELD_GENERIC,
    ) -> str:
        """
        Dekripsi dan verifikasi.

        Melempar cryptography.exceptions.InvalidTag bila ciphertext, nonce,
        atau salah satu komponen AAD (user_id / exchange_name / field) tidak
        cocok dengan saat enkripsi. JANGAN pernah menangkap InvalidTag lalu
        mengembalikan string kosong; itu menyembunyikan indikasi tampering.
        """
        ct = self._coerce_bytes(ciphertext, "ciphertext")
        nc = self._coerce_bytes(nonce, "nonce")

        if len(nc) != NONCE_BYTES:
            raise ValueError(
                f"Panjang nonce harus {NONCE_BYTES} byte, ditemukan {len(nc)}."
            )
        if len(ct) <= GCM_TAG_BYTES:
            raise ValueError(
                f"Ciphertext terlalu pendek ({len(ct)} byte); minimal "
                f"{GCM_TAG_BYTES + 1} byte termasuk tag GCM."
            )

        aad = self._build_aad(user_id, exchange_name, field)

        plaintext = self._aesgcm.decrypt(nc, ct, aad)  # -> InvalidTag bila tidak cocok
        return plaintext.decode("utf-8")

    # ---------------------- helper pasangan key/secret ------------------- #

    def encrypt_credential_pair(
        self,
        user_id: str,
        exchange_name: str,
        api_key: str,
        api_secret: str,
    ) -> dict[str, Any]:
        """
        Enkripsi pasangan api_key + api_secret menjadi satu baris database.

        Ini yang dipakai di service layer, bukan encrypt_credentials mentah.
        Dua nonce berbeda dihasilkan; keduanya tidak pernah sama.
        """
        key_blob = self.encrypt_credentials(
            user_id, api_key, exchange_name=exchange_name, field=FIELD_API_KEY
        )
        secret_blob = self.encrypt_credentials(
            user_id, api_secret, exchange_name=exchange_name, field=FIELD_API_SECRET
        )

        if key_blob["nonce"] == secret_blob["nonce"]:  # praktis mustahil; guard tetap ada
            raise RuntimeError("Tabrakan nonce terdeteksi. Operasi dibatalkan.")

        return {
            "user_id": self._normalize_user_id(user_id),
            "exchange_name": exchange_name.strip().upper(),
            "encrypted_api_key": key_blob["ciphertext"],
            "nonce_key": key_blob["nonce"],
            "encrypted_api_secret": secret_blob["ciphertext"],
            "nonce_secret": secret_blob["nonce"],
            "key_version": self._key_version,
        }

    def decrypt_credential_pair(self, row: dict[str, Any]) -> dict[str, str]:
        """
        Kebalikan dari encrypt_credential_pair. Terima satu baris hasil SELECT.

        Return {"api_key": ..., "api_secret": ...}
        Jangan pernah menaruh hasil ini di log, response body, atau exception message.
        """
        required = (
            "user_id",
            "exchange_name",
            "encrypted_api_key",
            "nonce_key",
            "encrypted_api_secret",
            "nonce_secret",
        )
        missing = [k for k in required if row.get(k) in (None, "")]
        if missing:
            raise ValueError(f"Baris kredensial tidak lengkap, kolom kosong: {missing}")

        user_id = str(row["user_id"])
        exchange = str(row["exchange_name"])

        return {
            "api_key": self.decrypt_credentials(
                user_id,
                row["encrypted_api_key"],
                row["nonce_key"],
                exchange_name=exchange,
                field=FIELD_API_KEY,
            ),
            "api_secret": self.decrypt_credentials(
                user_id,
                row["encrypted_api_secret"],
                row["nonce_secret"],
                exchange_name=exchange,
                field=FIELD_API_SECRET,
            ),
        }

    # ---------------------- util ----------------------------------------- #

    @staticmethod
    def _coerce_bytes(value: Any, label: str) -> bytes:
        """
        Terima bytes, memoryview (psycopg mengembalikan ini untuk bytea),
        atau string base64 / hex '\\x...' (kalau kolomnya TEXT).
        """
        if isinstance(value, (bytes, bytearray)):
            return bytes(value)
        if isinstance(value, memoryview):
            return value.tobytes()

        if isinstance(value, str):
            text = value.strip()
            if text.startswith("\\x"):  # format hex bytea Postgres
                try:
                    return bytes.fromhex(text[2:])
                except ValueError as exc:
                    raise ValueError(f"{label} hex tidak valid.") from exc
            try:
                return base64.b64decode(text, validate=True)
            except (binascii.Error, ValueError) as exc:
                raise ValueError(f"{label} base64 tidak valid.") from exc

        raise ValueError(f"{label} bertipe tidak didukung: {type(value).__name__}")

    @property
    def key_version(self) -> int:
        return self._key_version

    def __repr__(self) -> str:  # jangan pernah bocorkan material kunci
        return f"<CryptoVault key_version={self._key_version} algo=AES-256-GCM>"


# --------------------------------------------------------------------------- #
# Singleton
# --------------------------------------------------------------------------- #


@lru_cache(maxsize=1)
def get_vault() -> CryptoVault:
    """
    Instance tunggal untuk seluruh aplikasi.

    Sengaja lazy: kalau dimuat saat import, unit test dan perintah CLI yang
    tidak butuh enkripsi akan ikut crash saat MASTER_KEY belum di-set.

    Pakai sebagai FastAPI dependency:
        from fastapi import Depends
        def handler(vault: CryptoVault = Depends(get_vault)): ...

    Untuk fail-fast, panggil sekali di lifespan startup supaya deploy dengan
    kunci salah langsung mati, bukan mati saat user pertama menyimpan API key.
    """
    return CryptoVault.from_env()


# --------------------------------------------------------------------------- #
# Self-test: python -m app.services.crypto_vault
# --------------------------------------------------------------------------- #

if __name__ == "__main__":
    if not os.getenv(DEFAULT_ENV_VAR):
        os.environ[DEFAULT_ENV_VAR] = base64.b64encode(os.urandom(32)).decode()
        print("[i] MASTER_KEY sementara dibuat untuk self-test.\n")

    vault = get_vault()
    print(vault)

    alice = "11111111-1111-4111-8111-111111111111"
    mallory = "22222222-2222-4222-8222-222222222222"

    row = vault.encrypt_credential_pair(
        user_id=alice,
        exchange_name="BINANCE_FUTURES",
        api_key="AK_live_9f2c4d1e77b3",
        api_secret="SK_live_a83bd0e15c9f4471",
    )
    print(f"[1] Enkripsi OK. nonce_key != nonce_secret -> "
          f"{row['nonce_key'] != row['nonce_secret']}")

    restored = vault.decrypt_credential_pair(row)
    print(f"[2] Round-trip OK -> {restored['api_key'] == 'AK_live_9f2c4d1e77b3'}")

    # Serangan 1: baris dipindah ke user lain
    stolen = {**row, "user_id": mallory}
    try:
        vault.decrypt_credential_pair(stolen)
        print("[3] GAGAL: user_id palsu bisa dekripsi.")
    except InvalidTag:
        print("[3] Tolak user_id palsu -> InvalidTag. OK")

    # Serangan 2: exchange_name diubah
    swapped_exchange = {**row, "exchange_name": "BYBIT"}
    try:
        vault.decrypt_credential_pair(swapped_exchange)
        print("[4] GAGAL: exchange_name palsu bisa dekripsi.")
    except InvalidTag:
        print("[4] Tolak exchange_name palsu -> InvalidTag. OK")

    # Serangan 3: kolom api_key <-> api_secret ditukar dalam baris yang sama
    field_swap = {
        **row,
        "encrypted_api_key": row["encrypted_api_secret"],
        "nonce_key": row["nonce_secret"],
    }
    try:
        vault.decrypt_credential_pair(field_swap)
        print("[5] GAGAL: kolom tertukar bisa dekripsi.")
    except InvalidTag:
        print("[5] Tolak tukar kolom -> InvalidTag. OK")

    # Serangan 4: satu bit ciphertext diubah
    tampered = bytearray(row["encrypted_api_key"])
    tampered[0] ^= 0x01
    try:
        vault.decrypt_credentials(
            alice, bytes(tampered), row["nonce_key"],
            exchange_name="BINANCE_FUTURES", field=FIELD_API_KEY,
        )
        print("[6] GAGAL: ciphertext termodifikasi bisa dekripsi.")
    except InvalidTag:
        print("[6] Tolak bit-flip -> InvalidTag. OK")

    print("\nSemua pemeriksaan integritas lolos.")