"""
backend/app/api/execute_trade.py

ORACLE :: Multi-Exchange Auto-Trade Execution (CCXT Dynamic)

Fondasi eksekusi order lintas bursa berbasis "Workspace Configuration" milik
user (Primary Exchange + Trading Environment). TIDAK ada hardcode "Binance".

  - build_ccxt_exchange(exchange_id, market_type, ...) -> instance ccxt dinamis
    via getattr(ccxt, exchange_id).
  - Market routing: futures/perpetual -> options.defaultType = swap type bursa
    tsb ("swap" / "future"); spot -> "spot".
  - place_order(...) -> create_order generik; CCXT menerjemahkan ke API
    masing-masing bursa.

SaaS Publik / NON-CUSTODIAL
--------------------------
ORACLE tidak menyimpan kunci bursa siapa pun di server. Kredensial datang dari
payload request milik user (dikirim browser-nya sendiri) dan SELALU menang atas
kredensial `.env` server. `.env` hanya fallback opsional untuk deployment
single-tenant/dev, dan bisa dimatikan total lewat `EXCHANGE_ALLOW_SERVER_KEYS=false`
supaya eksekusi murni memakai kunci user.

Kredensial hanya hidup di memori selama satu request: tidak di-log, tidak
disimpan ke TradeStore, tidak pernah ikut di response.

Guardrail & gate (trade_live_enabled, dry_run, konfirmasi Human-in-the-Loop,
cap risiko/leverage/notional) tetap ditegakkan di TradeEngine / route — modul
ini hanya lapisan adaptor bursa.
"""

from __future__ import annotations

import logging
from typing import Any, NamedTuple

logger = logging.getLogger(__name__)

__all__ = [
    "SUPPORTED_EXCHANGES",
    "EXCHANGE_LABELS",
    "REQUIRES_PASSPHRASE",
    "ExchangeAdapterError",
    "MissingCredentials",
    "Credentials",
    "resolve_credentials",
    "build_ccxt_exchange",
    "to_ccxt_symbol",
    "place_order",
    "edit_stop_loss",
    "fetch_exchange_account",
    "futures_default_type",
    "validate_route",
    "redact",
]

# id ccxt (huruf kecil) -> label tampilan
EXCHANGE_LABELS: dict[str, str] = {
    "binance": "Binance",
    "okx": "OKX",
    "bybit": "Bybit",
    "mexc": "MEXC",
    "indodax": "Indodax",
}
SUPPORTED_EXCHANGES: set[str] = set(EXCHANGE_LABELS)

# Bursa yang HANYA punya spot (tidak ada perpetual/futures).
_SPOT_ONLY: set[str] = {"indodax"}

# defaultType CCXT untuk pasar futures/perpetual per bursa.
_FUTURES_TYPE: dict[str, str] = {
    "binance": "future",
    "okx": "swap",
    "bybit": "swap",
    "mexc": "swap",
}

# Bursa yang mewajibkan passphrase/`password` selain apiKey+secret.
# (CCXT memetakan passphrase ke field `password` pada config.)
REQUIRES_PASSPHRASE: set[str] = {"okx", "kucoin", "kucoinfutures", "bitget", "coinbase"}


class ExchangeAdapterError(RuntimeError):
    """Konfigurasi bursa / market tidak valid, atau CCXT tidak tersedia."""


class MissingCredentials(ExchangeAdapterError):
    """Kunci API user tidak lengkap untuk bursa yang dipilih."""


class Credentials(NamedTuple):
    """Kredensial bursa untuk SATU request. Jangan pernah di-log/di-persist."""

    api_key: str
    api_secret: str
    api_password: str | None
    source: str  # "user" | "server"


def redact(text: Any, *secrets: str | None) -> str:
    """
    Buang kunci user dari teks (mis. pesan error CCXT) sebelum masuk log atau
    response. Bursa kadang menggemakan apiKey di pesan errornya.
    """
    out = str(text)
    for secret in secrets:
        if secret and len(secret) >= 6:
            out = out.replace(secret, "***REDACTED***")
    return out


def futures_default_type(exchange_id: str) -> str:
    return _FUTURES_TYPE.get(exchange_id.lower(), "swap")


def _normalize(exchange_id: str, market_type: str) -> tuple[str, str]:
    ex = (exchange_id or "binance").strip().lower()
    mt = (market_type or "spot").strip().lower()
    if mt in ("perp", "perpetual", "swap", "future", "futures"):
        mt = "futures"
    elif mt != "spot":
        mt = "spot"
    if ex not in SUPPORTED_EXCHANGES:
        raise ExchangeAdapterError(
            f"Exchange '{ex}' tidak didukung. Pilihan: {', '.join(sorted(SUPPORTED_EXCHANGES))}."
        )
    if mt == "futures" and ex in _SPOT_ONLY:
        raise ExchangeAdapterError(
            f"{EXCHANGE_LABELS[ex]} hanya mendukung Spot — ganti Trading Environment ke Spot."
        )
    return ex, mt


def validate_route(exchange_id: str, market_type: str) -> tuple[str, str]:
    """Cek kombinasi bursa + tipe pasar valid (dipakai juga oleh dry-run)."""
    return _normalize(exchange_id, market_type)


def resolve_credentials(
    exchange_id: str,
    *,
    user_key: str | None = None,
    user_secret: str | None = None,
    user_passphrase: str | None = None,
    server_key: str | None = None,
    server_secret: str | None = None,
    server_passphrase: str | None = None,
    allow_server_fallback: bool = True,
) -> Credentials:
    """
    Tentukan kredensial yang dipakai, dengan PRIORITAS kunci milik user.

    Arsitektur SaaS publik non-custodial: kunci yang dikirim browser user selalu
    menang. `.env` server hanya jaring pengaman untuk deployment single-tenant
    dan bisa dimatikan lewat allow_server_fallback=False.

    Pasangan kunci tidak pernah dicampur: kalau user mengirim apiKey, secret-nya
    harus ikut dari user juga — menambal secret server ke apiKey user akan
    mengirim order dengan identitas yang salah.
    """
    ex = (exchange_id or "").strip().lower()
    label = EXCHANGE_LABELS.get(ex, ex.upper() or "Exchange")

    key = (user_key or "").strip()
    secret = (user_secret or "").strip()
    passphrase = (user_passphrase or "").strip() or None
    source = "user"

    if not (key and secret):
        if key or secret:
            raise MissingCredentials(
                f"Kredensial {label} tidak lengkap: API Key dan Secret Key harus "
                "diisi berpasangan di Settings → Workspace Configuration."
            )
        if not allow_server_fallback:
            raise MissingCredentials(
                f"Isi API Key, Secret Key{' dan Passphrase' if ex in REQUIRES_PASSPHRASE else ''} "
                f"{label} di Settings → Workspace Configuration untuk mengaktifkan Auto-Trade. "
                "Server ini tidak menyimpan kunci bursa siapa pun."
            )
        key = (server_key or "").strip()
        secret = (server_secret or "").strip()
        passphrase = (server_passphrase or "").strip() or None
        source = "server"

    if not (key and secret):
        raise MissingCredentials(
            f"Kredensial API {label} belum di-set. Isi API Key + Secret Key di "
            "Settings → Workspace Configuration."
        )

    if ex in REQUIRES_PASSPHRASE and not passphrase:
        raise MissingCredentials(
            f"{label} mewajibkan Passphrase selain API Key & Secret Key. "
            "Isi field 'Exchange Passphrase' di Settings → Workspace Configuration."
        )

    return Credentials(key, secret, passphrase, source)


def build_ccxt_exchange(
    exchange_id: str,
    market_type: str,
    *,
    api_key: str | None = None,
    api_secret: str | None = None,
    api_password: str | None = None,
    credentials: Credentials | None = None,
    testnet: bool = True,
) -> Any:
    """
    Instansiasi CCXT dinamis: exchange_class = getattr(ccxt, exchange_id).

    Kredensial: `credentials` (hasil resolve_credentials, jalur SaaS publik)
    diprioritaskan; api_key/api_secret/api_password hanya jalur langsung untuk
    pemanggil lama & test. Instance TIDAK pernah dibuat tanpa kunci — bursa akan
    menolaknya dengan error yang membingungkan, lebih baik gagal cepat di sini.
    """
    ex, mt = _normalize(exchange_id, market_type)

    if credentials is None:
        credentials = resolve_credentials(
            ex,
            user_key=api_key,
            user_secret=api_secret,
            user_passphrase=api_password,
            allow_server_fallback=False,
        )

    try:
        import ccxt  # type: ignore
    except Exception as exc:  # pragma: no cover
        raise ExchangeAdapterError(f"ccxt tidak tersedia: {exc}") from exc

    try:
        exchange_class = getattr(ccxt, ex)
    except AttributeError as exc:
        raise ExchangeAdapterError(f"ccxt tidak punya kelas '{ex}'.") from exc

    default_type = futures_default_type(ex) if mt == "futures" else "spot"
    config: dict[str, Any] = {
        "apiKey": credentials.api_key,
        "secret": credentials.api_secret,
        "enableRateLimit": True,
        "options": {"defaultType": default_type},
    }
    if credentials.api_password:
        config["password"] = credentials.api_password  # OKX/KuCoin passphrase

    exchange = exchange_class(config)

    if testnet:
        try:
            exchange.set_sandbox_mode(True)
        except Exception:
            logger.warning("%s tidak mendukung sandbox_mode — lanjut di endpoint live.", ex)

    # Sengaja hanya id bursa + asal kunci; JANGAN pernah log nilai kuncinya.
    logger.info(
        "Adaptor %s siap (market=%s, testnet=%s, kredensial=%s).",
        ex, mt, testnet, credentials.source,
    )
    return exchange


def to_ccxt_symbol(symbol: str, market_type: str, quote: str = "USDT") -> str:
    """
    'BTCUSDT' / 'BTC/USDT' -> unified CCXT symbol.
      spot     -> 'BTC/USDT'
      futures  -> 'BTC/USDT:USDT'  (linear perpetual)
    """
    s = (symbol or "").upper().replace("-", "/").strip()
    if "/" in s:
        base, _, q = s.partition("/")
        q = q or quote
    else:
        for cand in ("USDT", "USDC", "USD", "BUSD"):
            if s.endswith(cand):
                base, q = s[: -len(cand)], cand
                break
        else:
            base, q = s, quote
    pair = f"{base}/{q}"
    mt = (market_type or "spot").lower()
    return f"{pair}:{q}" if mt in ("futures", "swap", "perpetual", "future") else pair


def sl_tp_capability(exchange: Any) -> str:
    """
    Bagaimana bursa ini bisa memasang SL/TP NATIVE?

      "atomic"   -> SL & TP menempel pada order entry dalam SATU panggilan.
                    Tidak ada jendela waktu posisi tanpa proteksi.
      "separate" -> perlu conditional order terpisah setelah entry terisi.
      "none"     -> bursa tidak punya conditional order sama sekali.

    Dibaca dari flag kapabilitas CCXT, bukan daftar hardcoded, supaya ikut
    terbarui saat CCXT menambah dukungan.
    """
    has = getattr(exchange, "has", {}) or {}
    if has.get("createOrderWithTakeProfitAndStopLoss"):
        return "atomic"
    if has.get("createStopLossOrder") or has.get("createStopOrder"):
        return "separate"
    return "none"


def _native_trailing_params(exchange: Any, trailing_percent: float | None) -> dict[str, Any]:
    """
    Param trailing-stop NATIVE bila didukung CCXT untuk bursa ini.

    Bybit v5 & OKX menerima `trailingPercent` di params create_order (CCXT
    menormalkannya). Kalau tidak didukung, kembalikan {} — watchdog frontend
    yang jadi mekanisme trailing utama (lihat SmartStop di lib/paper-ledger.ts
    dan endpoint /trade/edit-sl).
    """
    if not trailing_percent or trailing_percent <= 0:
        return {}
    if getattr(exchange, "id", "") in ("bybit", "okx"):
        return {"trailingPercent": trailing_percent}
    return {}


def place_order(
    exchange: Any,
    *,
    symbol: str,
    side: str,
    order_type: str,
    amount: float,
    price: float | None,
    leverage: int | None,
    market_type: str,
    stop_loss: float | None = None,
    take_profit: float | None = None,
    trailing_percent: float | None = None,
) -> dict[str, Any]:
    """
    Kirim order entry + proteksi SL/TP NATIVE ke bursa.

    KENAPA NATIVE, BUKAN POLLING LOKAL: stop yang dijaga server kita sendiri
    baru bereaksi setelah polling berikutnya dan hanya hidup selama proses kita
    hidup. Stop yang dititipkan ke matching engine bursa dieksekusi di sana,
    dalam milidetik, dan tetap berlaku walau ORACLE mati total. Untuk uang
    sungguhan, hanya yang kedua yang layak.

    Kontrak keselamatan: kalau bursa TIDAK bisa memasang stop native, fungsi
    ini menolak SEBELUM entry dikirim — lebih baik gagal membuka posisi
    daripada memegang posisi live tanpa stop.
    """
    is_futures = (market_type or "spot").lower() in (
        "futures", "swap", "perpetual", "future"
    )
    mode = sl_tp_capability(exchange)
    ex_name = getattr(exchange, "id", "exchange")

    # --- Pre-flight: jangan pernah membuka posisi yang tak bisa dilindungi ---
    if stop_loss and mode == "none":
        raise ExchangeAdapterError(
            f"{ex_name.upper()} tidak mendukung conditional order, jadi Stop Loss "
            "tidak bisa dititipkan ke bursa. ORACLE menolak membuka posisi LIVE "
            "tanpa proteksi stop native."
        )

    if is_futures and leverage:
        try:
            exchange.set_leverage(int(leverage), symbol)
        except Exception:
            logger.warning("set_leverage %sx gagal untuk %s (lanjut).", leverage, symbol, exc_info=True)

    otype = order_type.lower()
    oside = side.lower()
    limit_price = price if order_type.upper() == "LIMIT" else None
    trailing = _native_trailing_params(exchange, trailing_percent)
    protection: dict[str, Any] = {
        "mode": mode, "stop_loss": None, "take_profit": None,
        "trailing": "native" if trailing else None,
    }

    # --- Jalur ATOMIC: SL/TP menempel di order entry (bybit, okx) ---------- #
    if stop_loss and mode == "atomic":
        order = exchange.create_order_with_take_profit_and_stop_loss(
            symbol, otype, oside, amount, limit_price,
            take_profit, stop_loss, dict(trailing),
        )
        protection.update(
            stop_loss="attached", take_profit="attached" if take_profit else None
        )
        return _order_result(order, protection)

    # --- Entry biasa ------------------------------------------------------- #
    order = exchange.create_order(
        symbol=symbol, type=otype, side=oside, amount=amount,
        price=limit_price, params={},
    )

    if not stop_loss:
        return _order_result(order, protection)

    # --- Jalur SEPARATE: conditional order reduce-only setelah entry ------- #
    # Sisi berlawanan: posisi BUY ditutup dengan SELL, dan sebaliknya.
    exit_side = "sell" if oside == "buy" else "buy"
    reduce_params = {"reduceOnly": True} if is_futures else {}

    try:
        sl_order = exchange.create_stop_loss_order(
            symbol, "market", exit_side, amount, None, stop_loss, dict(reduce_params)
        )
        protection["stop_loss"] = "placed"
        protection["stop_loss_id"] = sl_order.get("id")
    except Exception as exc:
        # Entry SUDAH terisi tapi stop GAGAL: posisi live tanpa proteksi.
        # Ini keadaan darurat — jangan didiamkan, jangan pula ditelan diam-diam.
        logger.error(
            "KRITIS: entry %s terisi tapi Stop Loss GAGAL dipasang (%s). "
            "Mencoba menutup posisi kembali.", symbol, type(exc).__name__,
        )
        protection["stop_loss"] = "FAILED"
        protection["stop_loss_error"] = type(exc).__name__
        try:
            exchange.create_order(
                symbol=symbol, type="market", side=exit_side, amount=amount,
                price=None, params=dict(reduce_params),
            )
            protection["unwound"] = True
            raise ExchangeAdapterError(
                f"Stop Loss gagal dipasang di {ex_name.upper()} "
                f"({type(exc).__name__}). Posisi langsung DITUTUP kembali agar "
                "tidak menggantung tanpa proteksi. Tidak ada posisi terbuka."
            ) from exc
        except ExchangeAdapterError:
            raise
        except Exception as unwind_exc:
            protection["unwound"] = False
            raise ExchangeAdapterError(
                f"BAHAYA: posisi {symbol} TERBUKA di {ex_name.upper()} tanpa Stop "
                f"Loss, dan penutupan darurat juga gagal ({type(unwind_exc).__name__}). "
                "Tutup posisi ini MANUAL di bursa sekarang juga."
            ) from unwind_exc

    if take_profit:
        try:
            tp_order = exchange.create_take_profit_order(
                symbol, "market", exit_side, amount, None, take_profit, dict(reduce_params)
            )
            protection["take_profit"] = "placed"
            protection["take_profit_id"] = tp_order.get("id")
        except Exception as exc:
            # TP gagal tidak fatal: stop (pelindung kerugian) sudah terpasang.
            logger.warning(
                "Take Profit %s gagal dipasang (%s); posisi tetap terlindungi SL.",
                symbol, type(exc).__name__,
            )
            protection["take_profit"] = "failed"

    return _order_result(order, protection)


def _order_result(order: dict[str, Any], protection: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": order.get("id"),
        "filled_price": order.get("average") or order.get("price"),
        "status": order.get("status"),
        "protection": protection,
        "raw": {k: order.get(k) for k in ("id", "symbol", "type", "side", "amount", "status")},
    }


def edit_stop_loss(
    exchange: Any,
    *,
    symbol: str,
    position_side: str,
    amount: float,
    new_stop_price: float,
    market_type: str,
    sl_order_id: str | None = None,
) -> dict[str, Any]:
    """
    Geser Stop Loss yang sedang aktif di bursa ke `new_stop_price`.

    `position_side` = sisi POSISI ("BUY"/"SELL"); order stop-nya di sisi
    berlawanan (posisi BUY ditutup dengan SELL).

    Strategi lintas bursa:
      1. Kalau bursa punya trading-stop level-posisi (Bybit/OKX) -> pakai itu:
         satu panggilan, tidak ada jendela tanpa proteksi.
      2. Kalau tidak, tapi ada sl_order_id & editOrder didukung -> edit_order.
      3. Fallback universal: cancel order lama (best-effort) -> create stop baru.

    Mengembalikan {method, sl_order_id, new_stop_price}. Melempar
    ExchangeAdapterError kalau semua jalur gagal — pemanggil harus memberi
    tahu user bahwa SL BELUM bergeser.
    """
    ex_id = getattr(exchange, "id", "exchange")
    is_futures = (market_type or "spot").lower() in (
        "futures", "swap", "perpetual", "future"
    )
    exit_side = "sell" if str(position_side).upper() == "BUY" else "buy"
    reduce_params = {"reduceOnly": True} if is_futures else {}

    # --- Jalur 1: trading-stop level posisi (Bybit v5, OKX) --------------- #
    # Aman & atomik: mengubah SL yang menempel pada posisi, bukan order.
    if ex_id in ("bybit", "okx") and is_futures:
        try:
            params = {"stopLoss": exchange.price_to_precision(symbol, new_stop_price)}
            if ex_id == "bybit":
                exchange.private_post_v5_position_trading_stop({
                    "category": "linear",
                    "symbol": exchange.market_id(symbol),
                    "stopLoss": params["stopLoss"],
                    "positionIdx": 0,
                })
            else:  # okx
                exchange.set_trading_stop  # type: ignore[attr-defined]
                exchange.private_post_trade_order_algo({
                    "instId": exchange.market_id(symbol),
                    "tdMode": "cross",
                    "side": exit_side,
                    "ordType": "conditional",
                    "slTriggerPx": params["stopLoss"],
                    "slOrdPx": "-1",
                    "closeFraction": "1",
                })
            return {
                "method": "position_trading_stop",
                "sl_order_id": sl_order_id,
                "new_stop_price": new_stop_price,
            }
        except Exception as exc:
            logger.warning(
                "trading-stop level posisi %s gagal (%s); coba jalur order.",
                ex_id, type(exc).__name__,
            )

    # --- Jalur 2: edit_order langsung ----------------------------------- #
    if sl_order_id and (getattr(exchange, "has", {}) or {}).get("editOrder"):
        try:
            edited = exchange.edit_order(
                sl_order_id, symbol, "market", exit_side, amount, None,
                {**reduce_params, "stopLossPrice": new_stop_price,
                 "triggerPrice": new_stop_price},
            )
            return {
                "method": "edit_order",
                "sl_order_id": edited.get("id") or sl_order_id,
                "new_stop_price": new_stop_price,
            }
        except Exception as exc:
            logger.warning(
                "edit_order SL %s gagal (%s); fallback cancel+create.",
                symbol, type(exc).__name__,
            )

    # --- Jalur 3: cancel lama + create baru (universal) ---------------- #
    if sl_order_id:
        try:
            exchange.cancel_order(sl_order_id, symbol)
        except Exception:
            # Order mungkin sudah tidak ada / sudah tereksekusi; lanjut saja.
            logger.debug("cancel_order %s (lama) gagal — lanjut buat SL baru.", sl_order_id)

    try:
        fresh = exchange.create_stop_loss_order(
            symbol, "market", exit_side, amount, None, new_stop_price,
            dict(reduce_params),
        )
    except Exception as exc:
        raise ExchangeAdapterError(
            f"Gagal memasang Stop Loss baru di {ex_id.upper()} "
            f"({type(exc).__name__}). SL LAMA mungkin sudah dibatalkan — "
            "periksa posisi di bursa."
        ) from exc

    return {
        "method": "cancel_recreate",
        "sl_order_id": fresh.get("id"),
        "new_stop_price": new_stop_price,
    }


# --------------------------------------------------------------------------- #
# Snapshot akun bursa (READ-ONLY — untuk "Smart Journal")
# --------------------------------------------------------------------------- #

_STABLES = ("USDT", "USDC", "USD", "BUSD", "DAI")


def fetch_exchange_account(
    exchange_id: str,
    market_type: str,
    *,
    credentials: Credentials,
) -> dict[str, Any]:
    """
    Ambil saldo + posisi terbuka dari akun bursa milik user.

    READ-ONLY: hanya fetch_balance / fetch_positions. Tidak pernah menempatkan
    order, jadi TIDAK di-gate oleh TRADE_LIVE_ENABLED. Dijalankan di endpoint
    LIVE (testnet=False) karena tujuannya justru saldo asli user.

    Kredensial dipakai sekali di sini lalu dibuang bersama instance CCXT-nya —
    tidak di-log, tidak disimpan. Kegagalan dikembalikan sebagai status
    "unavailable" dengan alasan, bukan exception yang bocor.
    """
    ex, mt = _normalize(exchange_id, market_type)
    label = EXCHANGE_LABELS.get(ex, ex.upper())
    base = {"exchange_id": ex, "exchange_label": label, "market_type": mt}

    try:
        exchange = build_ccxt_exchange(
            ex, mt, credentials=credentials, testnet=False
        )
    except ExchangeAdapterError as exc:
        return {
            **base, "status": "unavailable", "balance": None, "positions": [],
            "error": {"code": "adapter", "message": redact(
                exc, credentials.api_key, credentials.api_secret, credentials.api_password
            )},
        }

    balance: dict[str, float] = {}
    try:
        raw = exchange.fetch_balance()
        for coin in _STABLES:
            entry = (raw.get(coin) if isinstance(raw, dict) else None) or {}
            free = _num(entry.get("free"))
            total = _num(entry.get("total"))
            if free or total:
                balance[coin] = {"free": free, "total": total}
    except Exception as exc:
        return {
            **base, "status": "unavailable", "balance": None, "positions": [],
            "error": {"code": "fetch_balance", "message": redact(
                exc, credentials.api_key, credentials.api_secret, credentials.api_password
            )},
        }

    stable_total = round(sum(v["total"] for v in balance.values()), 2)
    stable_free = round(sum(v["free"] for v in balance.values()), 2)

    positions: list[dict[str, Any]] = []
    if mt == "futures":
        try:
            for p in exchange.fetch_positions() or []:
                contracts = _num(p.get("contracts"))
                if contracts <= 0:
                    continue
                positions.append({
                    "symbol": p.get("symbol"),
                    "side": str(p.get("side") or "").upper() or None,
                    "contracts": contracts,
                    "entry_price": _num(p.get("entryPrice")),
                    "mark_price": _num(p.get("markPrice")),
                    "unrealized_pnl": _num(p.get("unrealizedPnl")),
                    "leverage": _num(p.get("leverage")) or None,
                    "notional": _num(p.get("notional")),
                })
        except Exception:
            # Posisi opsional — saldo saja sudah berguna untuk Smart Balance.
            logger.debug("fetch_positions gagal untuk %s (tidak fatal).", ex, exc_info=True)

    return {
        **base,
        "status": "ok",
        "balance": {
            "by_coin": balance,
            "stable_total_usd": stable_total,
            "stable_free_usd": stable_free,
        },
        "positions": positions,
        "error": None,
    }


def _num(value: Any) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return 0.0
    return n if n == n and abs(n) != float("inf") else 0.0
