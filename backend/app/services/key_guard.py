"""
backend/app/services/key_guard.py

ORACLE :: API Key Permission Interceptor

Menolak kunci API bursa yang masih punya izin PENARIKAN (withdraw) atau
TRANSFER. Arsitektur ORACLE non-custodial: kunci hidup di browser user dan
dikirim per-request. Kalau kunci itu bisa menarik dana, satu XSS = dana hilang.
Kunci trade-only tidak bisa memindahkan dana keluar bursa — itu batas kerugian
maksimum yang kita tegakkan di sini.

CCXT 4.5 TIDAK punya `fetchPermissions` terpadu, jadi tiap bursa dibaca lewat
endpoint privatnya sendiri:
  - bybit   : GET /v5/user/query-api        -> result.permissions{}, readOnly
  - okx     : GET /api/v5/account/config    -> data[0].perm ("read_only,trade")
  - binance : GET /sapi/v1/account/apiRestrictions -> enableWithdrawals, dll.
  - mexc / indodax : TIDAK ADA endpoint izin -> tidak bisa diverifikasi.

TIGA KEADAAN, bukan dua — ini inti kejujuran modul ini:
  "safe"    : terbukti TIDAK ada izin withdraw/transfer  -> boleh disimpan
  "unsafe"  : TERBUKTI ada izin withdraw/transfer        -> DITOLAK (403)
  "unknown" : bursa tidak menyediakan cara memverifikasi -> boleh disimpan,
              TAPI UI wajib bilang "tidak terverifikasi", bukan "aman".
  "invalid" : kunci ditolak bursa (auth gagal)           -> DITOLAK (400)

Memblokir "unknown" akan membuat user MEXC/Indodax tidak pernah bisa memakai
Auto-Trade; menyebutnya "safe" akan berbohong soal keamanan. Karena itu keadaan
ketiga ada dan harus sampai ke UI apa adanya.
"""

from __future__ import annotations

import logging
from typing import Any, Iterable, NamedTuple

logger = logging.getLogger(__name__)

__all__ = ["KeyVerdict", "inspect_api_key", "WITHDRAW_HINTS", "TRANSFER_HINTS"]

# Dicocokkan case-insensitive terhadap SETIAP string di struktur izin bursa.
# Sengaja berbasis substring: nama izin berubah antar versi API, dan yang kita
# cari adalah kelas kemampuan, bukan satu label persis.
WITHDRAW_HINTS = ("withdraw", "withdrawal")
TRANSFER_HINTS = ("transfer",)

# Bursa yang izinnya bisa kita baca. Selain ini -> "unknown", jujur.
VERIFIABLE = {"bybit", "okx", "binance"}


class KeyVerdict(NamedTuple):
    state: str                 # safe | unsafe | unknown | invalid
    withdraw: bool | None      # None = tidak diketahui
    transfer: bool | None
    read_only: bool | None
    checked_via: str           # endpoint yang dipakai, atau "unsupported"
    matched: tuple[str, ...]   # label izin yang memicu penolakan
    message: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "withdraw": self.withdraw,
            "transfer": self.transfer,
            "read_only": self.read_only,
            "checked_via": self.checked_via,
            "matched_permissions": list(self.matched),
            "message": self.message,
        }


def _walk_strings(node: Any) -> Iterable[str]:
    """Kumpulkan semua string di struktur bersarang (dict/list) apa pun."""
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield str(k)
            yield from _walk_strings(v)
    elif isinstance(node, (list, tuple, set)):
        for v in node:
            yield from _walk_strings(v)


def _match(labels: Iterable[str], hints: tuple[str, ...]) -> tuple[str, ...]:
    hit = []
    for raw in labels:
        low = raw.lower()
        if any(h in low for h in hints):
            hit.append(raw)
    return tuple(dict.fromkeys(hit))


def _is_auth_error(exc: Exception) -> bool:
    try:
        import ccxt  # type: ignore

        return isinstance(
            exc, (ccxt.AuthenticationError, ccxt.PermissionDenied, ccxt.InvalidNonce)
        )
    except Exception:  # pragma: no cover
        return False


# --------------------------------------------------------------------------- #
# Pembaca izin per bursa
# --------------------------------------------------------------------------- #


def _inspect_bybit(exchange: Any) -> KeyVerdict:
    body = exchange.privateGetV5UserQueryApi()
    result = (body or {}).get("result") or {}
    perms = result.get("permissions") or {}

    # Bybit: readOnly == 1 berarti kunci hanya baca — pasti tidak bisa withdraw.
    read_only = str(result.get("readOnly", "")) in ("1", "True", "true")

    labels = list(_walk_strings(perms))
    w = _match(labels, WITHDRAW_HINTS)
    t = _match(labels, TRANSFER_HINTS)
    return _verdict("bybit", "GET /v5/user/query-api", w, t, read_only)


def _inspect_okx(exchange: Any) -> KeyVerdict:
    body = exchange.privateGetAccountConfig()
    rows = (body or {}).get("data") or []
    perm = str((rows[0] if rows else {}).get("perm") or "")
    # OKX: "read_only", "trade", "withdraw" dipisah koma.
    labels = [p.strip() for p in perm.split(",") if p.strip()]
    read_only = bool(labels) and all(p.lower() == "read_only" for p in labels)
    w = _match(labels, WITHDRAW_HINTS)
    t = _match(labels, TRANSFER_HINTS)
    return _verdict("okx", "GET /api/v5/account/config", w, t, read_only)


def _inspect_binance(exchange: Any) -> KeyVerdict:
    body = exchange.sapiGetAccountApiRestrictions()
    # Boolean eksplisit — tidak perlu menebak dari nama.
    flags = {k: v for k, v in (body or {}).items() if isinstance(v, bool)}
    withdraw = [k for k, v in flags.items() if v and _match([k], WITHDRAW_HINTS)]
    transfer = [k for k, v in flags.items() if v and _match([k], TRANSFER_HINTS)]
    read_only = bool(flags.get("enableReading")) and not any(
        v for k, v in flags.items() if k != "enableReading" and k != "ipRestrict"
    )
    return _verdict(
        "binance",
        "GET /sapi/v1/account/apiRestrictions",
        tuple(withdraw),
        tuple(transfer),
        read_only,
    )


_READERS = {
    "bybit": _inspect_bybit,
    "okx": _inspect_okx,
    "binance": _inspect_binance,
}


def _verdict(
    exchange_id: str,
    endpoint: str,
    withdraw_hits: tuple[str, ...],
    transfer_hits: tuple[str, ...],
    read_only: bool | None,
) -> KeyVerdict:
    if withdraw_hits or transfer_hits:
        kind = "withdraw" if withdraw_hits else "transfer"
        return KeyVerdict(
            state="unsafe",
            withdraw=bool(withdraw_hits),
            transfer=bool(transfer_hits),
            read_only=read_only,
            checked_via=endpoint,
            matched=withdraw_hits + transfer_hits,
            message=(
                f"Kunci API {exchange_id.upper()} masih mengaktifkan izin "
                f"{kind.upper()} ({', '.join(withdraw_hits + transfer_hits)})."
            ),
        )
    return KeyVerdict(
        state="safe",
        withdraw=False,
        transfer=False,
        read_only=read_only,
        checked_via=endpoint,
        matched=(),
        message=(
            f"Kunci API {exchange_id.upper()} terverifikasi tanpa izin "
            "penarikan maupun transfer."
        ),
    )


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def inspect_api_key(exchange_id: str, *, credentials: Any) -> KeyVerdict:
    """
    Baca hak akses kunci API dari bursa. TIDAK pernah melempar exception —
    kegagalan dikembalikan sebagai state ("invalid"/"unknown") supaya route
    bisa memetakannya ke kode HTTP yang tepat.
    """
    ex_id = (exchange_id or "").strip().lower()

    if ex_id not in VERIFIABLE:
        return KeyVerdict(
            state="unknown",
            withdraw=None, transfer=None, read_only=None,
            checked_via="unsupported",
            matched=(),
            message=(
                f"{ex_id.upper()} tidak menyediakan endpoint untuk membaca izin "
                "kunci API, jadi ORACLE TIDAK bisa memverifikasinya. Pastikan "
                "sendiri izin Withdraw/Penarikan dimatikan di bursa Anda."
            ),
        )

    from app.api.execute_trade import ExchangeAdapterError, build_ccxt_exchange, redact

    try:
        # testnet=False: izin harus dibaca dari akun produksi yang sebenarnya.
        exchange = build_ccxt_exchange(
            ex_id, "spot", credentials=credentials, testnet=False
        )
    except ExchangeAdapterError as exc:
        return KeyVerdict(
            state="unknown",
            withdraw=None, transfer=None, read_only=None,
            checked_via="adapter_failed", matched=(),
            message=redact(
                exc, credentials.api_key, credentials.api_secret, credentials.api_password
            ),
        )

    try:
        return _READERS[ex_id](exchange)
    except Exception as exc:
        safe_msg = _safe_message(exc, credentials)
        if _is_auth_error(exc):
            return KeyVerdict(
                state="invalid",
                withdraw=None, transfer=None, read_only=None,
                checked_via=f"{ex_id}:auth_failed", matched=(),
                message=(
                    f"Bursa {ex_id.upper()} menolak kunci ini "
                    f"({type(exc).__name__}). Periksa API Key/Secret"
                    + (" /Passphrase" if ex_id == "okx" else "")
                    + ", dan pastikan IP server diizinkan."
                ),
            )
        # Jaringan / rate limit / endpoint berubah -> jangan blokir user,
        # tapi juga JANGAN bilang aman.
        logger.warning(
            "Pemeriksaan izin %s gagal: %s", ex_id, type(exc).__name__
        )
        return KeyVerdict(
            state="unknown",
            withdraw=None, transfer=None, read_only=None,
            checked_via=f"{ex_id}:check_failed", matched=(),
            message=(
                f"ORACLE tidak bisa memeriksa izin kunci di {ex_id.upper()} "
                f"saat ini ({type(exc).__name__}). Pastikan sendiri izin "
                "Withdraw/Penarikan dimatikan."
            ),
        )


def _safe_message(exc: Exception, credentials: Any) -> str:
    from app.api.execute_trade import redact

    return redact(
        exc, credentials.api_key, credentials.api_secret, credentials.api_password
    )
