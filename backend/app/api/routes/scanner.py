import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
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
        # INI DIA KUNCI JAWABANNYA: Mengizinkan paket grafik TradingView lewat!
        "chartData": indicators.get("chartData", []) 
    }

def get_market_data():
    engine = IndicatorEngine()
    results = []

    for coin, pair in COINS:
        try:
            indicators = engine.analyze(pair)
            if not indicators:
                continue
                
            signal_data = calculate_signal(indicators)
            results.append({
                "coin": coin,
                **signal_data
            })
        except Exception as e:
            print(f"Error kalkulasi data {coin} | Error: {e}")
            continue

    results.sort(key=lambda x: x["confidence"], reverse=True)
    return results

@router.get("/scanner/signals")
def scan_signals():
    return {"signals": get_market_data()}

@router.websocket("/ws/scanner")
async def websocket_scanner(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = get_market_data()
            
            if len(data) == 0:
                await websocket.send_json({"error": "RATE_LIMIT", "signals": []})
            else:
                await websocket.send_json({"signals": data})
            
            await asyncio.sleep(12)
            
    except WebSocketDisconnect:
        print("Frontend terputus dari siaran Live Scanner.")
    except Exception as e:
        print(f"Error pada sistem WebSocket: {e}")
        await websocket.close()