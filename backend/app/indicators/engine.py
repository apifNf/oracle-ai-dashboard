import requests
import pandas as pd
import numpy as np
import time

class IndicatorEngine:
    def format_symbol(self, symbol):
        return symbol.replace("/", "")

    def generate_mock_data(self, symbol):
        candles = []
        base_price = 60000 if "BTC" in symbol else 3000 if "ETH" in symbol else 100
        current_price = base_price
        current_time = int(time.time() * 1000) - (100 * 3600 * 1000)
        
        for _ in range(100):
            # Menciptakan data Open, High, Low, Close palsu yang realistis
            open_p = current_price
            close_p = open_p * (1 + np.random.normal(0, 0.01))
            high_p = max(open_p, close_p) * (1 + abs(np.random.normal(0, 0.005)))
            low_p = min(open_p, close_p) * (1 - abs(np.random.normal(0, 0.005)))
            
            candles.append([current_time, open_p, high_p, low_p, close_p])
            current_time += 3600 * 1000
            current_price = close_p
            
        return pd.DataFrame(candles, columns=["timestamp", "open", "high", "low", "close"])

    def get_ohlcv(self, symbol="BTC/USDT"):
        formatted_symbol = self.format_symbol(symbol)
        
        # 1. JALUR BINANCE ANTI-BLOKIR (Mengambil O, H, L, C)
        try:
            url = "https://api.binance.info/api/v3/klines"
            res = requests.get(url, params={"symbol": formatted_symbol, "interval": "1h", "limit": 100}, timeout=5)
            if res.status_code == 200:
                data = res.json()
                # Format Binance: [OpenTime, Open, High, Low, Close, ...]
                candles = [[item[0], float(item[1]), float(item[2]), float(item[3]), float(item[4])] for item in data]
                return pd.DataFrame(candles, columns=["timestamp", "open", "high", "low", "close"])
        except Exception:
            pass 

        # 2. JALUR GATE.IO
        try:
            gate_symbol = symbol.replace("/", "_") 
            url = "https://api.gateio.ws/api/v4/spot/candlesticks"
            res = requests.get(url, params={"currency_pair": gate_symbol, "interval": "1h", "limit": 100}, timeout=5)
            if res.status_code == 200:
                data = res.json()
                # Format Gateio: [timestamp, volume, close, high, low, open]
                candles = [[int(item[0]) * 1000, float(item[5]), float(item[3]), float(item[4]), float(item[2])] for item in data]
                return pd.DataFrame(candles, columns=["timestamp", "open", "high", "low", "close"])
        except Exception:
            pass 
            
        return self.generate_mock_data(symbol)

    def calculate_rsi(self, series, period=14):
        delta = series.diff()
        gain = delta.clip(lower=0)
        loss = -delta.clip(upper=0)
        avg_gain = gain.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
        rs = avg_gain / avg_loss
        return 100 - (100 / (1 + rs))

    def analyze(self, symbol="BTC/USDT"):
        df = self.get_ohlcv(symbol)

        if df is None or df.empty:
            return None

        df["ema20"] = df["close"].ewm(span=20, adjust=False).mean()
        df["ema50"] = df["close"].ewm(span=50, adjust=False).mean()
        df["rsi"] = self.calculate_rsi(df["close"])

        latest = df.iloc[-1]
        trend = "bullish" if latest["ema20"] > latest["ema50"] else "bearish"
        
        rsi_value = float(latest["rsi"])
        if pd.isna(rsi_value):
            rsi_value = 50.0 

        # -------------------------------------------------------------
        # PERSIAPAN KANVAS: Meracik data candle khusus untuk TradingView
        # -------------------------------------------------------------
        chart_data = []
        # Kita ambil 45 candle terakhir agar grafik terlihat proporsional di kartu
        for _, row in df.tail(45).iterrows():
            chart_data.append({
                "time": int(row["timestamp"] / 1000), # TradingView butuh format detik
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"])
            })

        return {
            "symbol": symbol,
            "price": float(latest["close"]),
            "ema20": float(latest["ema20"]),
            "ema50": float(latest["ema50"]),
            "rsi": rsi_value,
            "trend": trend,
            "chartData": chart_data  # <--- PAKET LILIN TRADINGVIEW DIKIRIM KE DEPAN!
        }