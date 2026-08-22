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
        
        # 1. TOPENG PENYAMARAN: Agar Render tidak diblokir oleh CoinGecko
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json"
        }

        try:
            response = requests.get(url, params=params, headers=headers, timeout=10)
            data = response.json()
            
            # 2. SISTEM ANTI-HANCUR: Jika CoinGecko memblokir dan mengirim Dictionary error
            if isinstance(data, dict) and "status" in data:
                raise Exception(f"CoinGecko memblokir server: {data['status'].get('error_message', 'Limit tercapai')}")

            if not data or not isinstance(data, list):
                raise Exception(f"Data tidak valid untuk {symbol}")

            coin = data[0]

            return {
                "symbol": symbol,
                "price": coin.get("current_price", 0),
                "change_24h": coin.get("price_change_percentage_24h") or 0,
                "market_cap": coin.get("market_cap", 0),
                "volume_24h": coin.get("total_volume", 0),
            }
            
        except Exception as e:
            # Jika tetap gagal, jangan crash. Beri data 0 agar AI bisa tetap membalas chat.
            print(f"Error fetching data: {str(e)}")
            return {
                "symbol": symbol,
                "price": 0,
                "change_24h": 0,
                "market_cap": 0,
                "volume_24h": 0,
            }
