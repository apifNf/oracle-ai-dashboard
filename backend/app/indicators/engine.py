import requests
import pandas as pd


class IndicatorEngine:
    COIN_MAP = {
        "BTC/USDT": "bitcoin",
        "ETH/USDT": "ethereum",
        "SOL/USDT": "solana",
        "BNB/USDT": "binancecoin",
        "XRP/USDT": "ripple",
        "ADA/USDT": "cardano",
        "HYPE/USDT": "hyperliquid",
    }

    def get_ohlcv(self, symbol="BTC/USDT"):
        coin_id = self.COIN_MAP.get(symbol, "bitcoin")

        url = f"https://api.coingecko.com/api/v3/coins/{coin_id}/market_chart"

        params = {
            "vs_currency": "usd",
            "days": 7,
            "interval": "hourly"
        }

        response = requests.get(url, params=params, timeout=10)
        data = response.json()["prices"]

        closes = []

        for item in data:
            closes.append([
                item[0],
                float(item[1])
            ])

        df = pd.DataFrame(closes, columns=["timestamp", "close"])

        return df

    def calculate_rsi(self, series, period=14):
        delta = series.diff()

        gain = delta.where(delta > 0, 0)
        loss = -delta.where(delta < 0, 0)

        avg_gain = gain.rolling(period).mean()
        avg_loss = loss.rolling(period).mean()

        rs = avg_gain / avg_loss
        rsi = 100 - (100 / (1 + rs))

        return rsi

    def analyze(self, symbol="BTC/USDT"):
        df = self.get_ohlcv(symbol)

        df["ema20"] = df["close"].ewm(span=20, adjust=False).mean()
        df["ema50"] = df["close"].ewm(span=50, adjust=False).mean()
        df["rsi"] = self.calculate_rsi(df["close"])

        latest = df.iloc[-1]

        trend = "bullish" if latest["ema20"] > latest["ema50"] else "bearish"

        return {
            "symbol": symbol,
            "price": float(latest["close"]),
            "ema20": float(latest["ema20"]),
            "ema50": float(latest["ema50"]),
            "rsi": float(latest["rsi"]),
            "trend": trend,
        }