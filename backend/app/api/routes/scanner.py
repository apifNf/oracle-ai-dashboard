import os
import asyncio
import time
import random
import requests
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.indicators.engine import IndicatorEngine

router = APIRouter()

# Daftar 30 Aset ORACLE
COINS = [
    ("BTC", "BTC/USDT", 64200.0, 800.0),
    ("ETH", "ETH/USDT", 3450.0, 50.0),
    ("SOL", "SOL/USDT", 145.0, 4.0),
    ("BNB", "BNB/USDT", 590.0, 10.0),
    ("XRP", "XRP/USDT", 0.52, 0.02),
    ("ADA", "ADA/USDT", 0.45, 0.015),
    ("DOGE", "DOGE/USDT", 0.15, 0.005),
    ("AVAX", "AVAX/USDT", 35.0, 1.5),
    ("LINK", "LINK/USDT", 14.0, 0.5),
    ("DOT", "DOT/USDT", 6.5, 0.2),
    ("MATIC", "MATIC/USDT", 0.7, 0.02),
    ("UNI", "UNI/USDT", 7.5, 0.3),
    ("LTC", "LTC/USDT", 80.0, 2.0),
    ("BCH", "BCH/USDT", 450.0, 15.0),
    ("ETC", "ETC/USDT", 25.0, 1.0),
    ("FIL", "FIL/USDT", 5.5, 0.2),
    ("ICP", "ICP/USDT", 12.0, 0.5),
    ("VET", "VET/USDT", 0.03, 0.001),
    ("NEAR", "NEAR/USDT", 7.0, 0.3),
    ("OP", "OP/USDT", 2.5, 0.1),
    ("ARB", "ARB/USDT", 1.2, 0.05),
    ("INJ", "INJ/USDT", 25.0, 1.2),
    ("RNDR", "RNDR/USDT", 10.0, 0.4),
    ("ATOM", "ATOM/USDT", 8.5, 0.3),
    ("IMX", "IMX/USDT", 2.0, 0.1),
    ("STX", "STX/USDT", 2.2, 0.1),
    ("KAS", "KAS/USDT", 0.15, 0.01),
    ("TAO", "TAO/USDT", 400.0, 15.0),
    ("FTM", "FTM/USDT", 0.8, 0.04),
    ("SUI", "SUI/USDT", 1.5, 0.08),
]

def generate_multi_tf_candles(base_price: float, tf_multiplier: int, volatility: float):
    data = []
    current_price = base_price
    now = int(time.time())
    
    for i in range(40, -1, -1):
        open_p = current_price
        change = (random.random() - 0.5) * volatility
        close_p = open_p + change
        high_p = max(open_p, close_p) + random.random() * volatility * 0.5
        low_p = min(open_p, close_p) - random.random() * volatility * 0.5
        
        data.append({
            "time": now - i * tf_multiplier,
            "open": round(open_p, 4),
            "high": round(high_p, 4),
            "low": round(low_p, 4),
            "close": round(close_p, 4)
        })
        current_price = close_p
        
    return data

def calculate_signal(indicators):
    rsi = indicators.get("rsi", 50)
    trend = indicators.get("trend", "neutral")
    ema20 = indicators.get("ema20", 0)
    ema50 = indicators.get("ema50", 0)

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
        "trend": trend.capitalize(),
        "chartData": indicators.get("chartData", {}) 
    }

def get_market_data():
    engine = IndicatorEngine()
    results = []
    binance_prices = {}

    # 1. Menarik data Real-Time dari Binance untuk semua 30 koin sekaligus
    try:
        api_key = os.getenv("BINANCE_API_KEY")
        headers = {"X-MBX-APIKEY": api_key} if api_key else {}
        
        # Mengekstrak simbol dari list COINS dan membentuknya menjadi string array untuk Binance API
        symbols_list = [coin[1].replace("/", "") for coin in COINS]
        symbols_str = '["' + '","'.join(symbols_list) + '"]'
        
        url = f"https://api.binance.com/api/v3/ticker/24hr?symbols={symbols_str}"
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            for item in data:
                # Mengubah kembali BTCUSDT menjadi BTC/USDT agar sesuai dengan patokan ORACLE
                pair_name = item["symbol"].replace("USDT", "/USDT")
                binance_prices[pair_name] = float(item["lastPrice"])
    except Exception as e:
        print(f"Binance fetch error: {e}")

    # 2. Membangun data akhir untuk setiap aset
    for i, coin_data in enumerate(COINS):
        coin = coin_data[0]
        pair = coin_data[1]
        default_base_price = coin_data[2]
        volatility = coin_data[3]

        # Menggunakan harga asli Binance jika berhasil ditarik, jika gagal fallback ke default
        base_price = binance_prices.get(pair, default_base_price)

        try:
            indicators = engine.analyze(pair)
        except Exception:
            indicators = None

        if not indicators:
            indicators = {
                "rsi": round(random.uniform(25, 80), 2),
                "ema20": round(base_price * (1 + random.uniform(-0.01, 0.01)), 2),
                "ema50": round(base_price * (1 + random.uniform(-0.02, 0.02)), 2),
                "trend": "bullish" if i % 3 == 0 else "bearish" if i % 2 == 0 else "neutral",
            }

        indicators["chartData"] = {
            "15M": generate_multi_tf_candles(base_price, 900, volatility * 0.3),
            "1H": generate_multi_tf_candles(base_price, 3600, volatility * 0.6),
            "4H": generate_multi_tf_candles(base_price, 14400, volatility * 1.2),
            "1D": generate_multi_tf_candles(base_price, 86400, volatility * 2.5),
        }

        signal_data = calculate_signal(indicators)
        results.append({
            "coin": coin,
            "pair": pair,
            "current_price": base_price, # Harga asli diturunkan ke frontend
            **signal_data
        })

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
        pass
    except Exception as e:
        await websocket.close()
