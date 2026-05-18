import requests


class MarketDataService:
    COIN_MAP = {
        "BTC": "bitcoin",
        "ETH": "ethereum",
        "SOL": "solana",
        "BNB": "binancecoin",
        "XRP": "ripple",
        "ADA": "cardano",
        "HYPE": "hyperliquid",
    }

    def get_coin_data(self, symbol: str):
        symbol = symbol.upper()
        coin_id = self.COIN_MAP.get(symbol, "bitcoin")

        url = f"https://api.coingecko.com/api/v3/coins/markets"

        params = {
            "vs_currency": "usd",
            "ids": coin_id,
        }

        response = requests.get(url, params=params, timeout=10)
        data = response.json()

        if not data:
            raise Exception(f"No market data found for {symbol}")

        coin = data[0]

        return {
            "symbol": symbol,
            "price": coin["current_price"],
            "change_24h": coin["price_change_percentage_24h"] or 0,
            "market_cap": coin["market_cap"],
            "volume_24h": coin["total_volume"],
        }