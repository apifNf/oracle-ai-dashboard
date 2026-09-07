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

Guardrail & gate (trade_live_enabled, dry_run, konfirmasi Human-in-the-Loop,
cap risiko/leverage/notional) tetap ditegakkan di TradeEngine / route — modul
ini hanya lapisan adaptor bursa.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

__all__ = [
    "SUPPORTED_EXCHANGES",
    "EXCHANGE_LABELS",
    "ExchangeAdapterError",
    "build_ccxt_exchange",
    "to_ccxt_symbol",
    "place_order",
    "futures_default_type",
    "validate_route",
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


class ExchangeAdapterError(RuntimeError):
    """Konfigurasi bursa / market tidak valid, atau CCXT tidak tersedia."""


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


def build_ccxt_exchange(
    exchange_id: str,
    market_type: str,
    *,
    api_key: str | None,
    api_secret: str | None,
    api_password: str | None = None,
    testnet: bool = True,
) -> Any:
    """Instansiasi CCXT dinamis: exchange_class = getattr(ccxt, exchange_id)."""
    ex, mt = _normalize(exchange_id, market_type)

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
        "apiKey": api_key,
        "secret": api_secret,
        "enableRateLimit": True,
        "options": {"defaultType": default_type},
    }
    if api_password:
        config["password"] = api_password  # OKX passphrase, dll.

    exchange = exchange_class(config)

    if testnet:
        try:
            exchange.set_sandbox_mode(True)
        except Exception:
            logger.warning("%s tidak mendukung sandbox_mode — lanjut di endpoint live.", ex)

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
) -> dict[str, Any]:
    """create_order generik lintas bursa. CCXT menerjemahkan ke API bursa."""
    is_futures = (market_type or "spot").lower() in (
        "futures", "swap", "perpetual", "future"
    )
    if is_futures and leverage:
        try:
            exchange.set_leverage(int(leverage), symbol)
        except Exception:
            logger.warning("set_leverage %sx gagal untuk %s (lanjut).", leverage, symbol, exc_info=True)

    order = exchange.create_order(
        symbol=symbol,
        type=order_type.lower(),
        side=side.lower(),
        amount=amount,
        price=price if order_type.upper() == "LIMIT" else None,
        params={},
    )
    return {
        "id": order.get("id"),
        "filled_price": order.get("average") or order.get("price"),
        "status": order.get("status"),
        "raw": {k: order.get(k) for k in ("id", "symbol", "type", "side", "amount", "status")},
    }
