from fastapi import APIRouter
from app.indicators.engine import IndicatorEngine

router = APIRouter()

COINS = [
    ("BTC", "BTC/USDT"),
    ("ETH", "ETH/USDT"),
    ("SOL", "SOL/USDT"),
    ("BNB", "BNB/USDT"),
    ("XRP", "XRP/USDT"),
    ("ADA", "ADA/USDT"),
    ("HYPE", "HYPE/USDT"),
]

def calculate_signal(indicators):
    rsi = indicators["rsi"]
    trend = indicators["trend"]
    ema20 = indicators["ema20"]
    ema50 = indicators["ema50"]

    if trend == "bullish":
        if rsi < 70:
            signal = "LONG"
            confidence = 80 if rsi > 50 else 65
        else:
            signal = "WAIT"
            confidence = 55

    elif trend == "bearish":
        if rsi > 30:
            signal = "SHORT"
            confidence = 80 if rsi < 50 else 65
        else:
            signal = "WAIT"
            confidence = 55
    else:
        signal = "WAIT"
        confidence = 40

    return {
        "signal": signal,
        "confidence": confidence,
        "rsi": rsi,
        "ema20": ema20,
        "ema50": ema50,
        "trend": trend,
    }

@router.get("/scanner/signals")
def scan_signals():
    engine = IndicatorEngine()
    results = []

    for coin, pair in COINS:
        try:
            indicators = engine.analyze(pair)
            signal_data = calculate_signal(indicators)

            results.append({
                "coin": coin,
                **signal_data
            })

        except Exception:
            continue

    results.sort(key=lambda x: x["confidence"], reverse=True)

    return {
        "signals": results
    }