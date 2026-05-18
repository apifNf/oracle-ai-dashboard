from openai import OpenAI
from app.core.config import settings
from app.services.market_data import MarketDataService
from app.indicators.engine import IndicatorEngine


class AIExplanationService:
    def __init__(self):
        self.client = OpenAI(api_key=settings.openai_api_key)
        self.market = MarketDataService()
        self.indicators = IndicatorEngine()

    def detect_symbol(self, prompt: str):
        prompt = prompt.upper()

        if "ETH" in prompt:
            return "ETH", "ETH/USDT"
        elif "SOL" in prompt:
            return "SOL", "SOL/USDT"
        elif "BNB" in prompt:
            return "BNB", "BNB/USDT"
        elif "XRP" in prompt:
            return "XRP", "XRP/USDT"
        elif "ADA" in prompt:
            return "ADA", "ADA/USDT"
        elif "HYPE" in prompt:
            return "HYPE", "HYPE/USDT"

        return "BTC", "BTC/USDT"

    def calculate_bias(self, indicators):
        rsi = indicators["rsi"]
        trend = indicators["trend"]

        if trend == "bullish":
            if rsi >= 70:
                return {
                    "bias": "Bullish",
                    "confidence": "Medium",
                    "warning": "Overbought risk"
                }
            elif rsi >= 50:
                return {
                    "bias": "Bullish",
                    "confidence": "High",
                    "warning": "Healthy momentum"
                }
            else:
                return {
                    "bias": "Bullish",
                    "confidence": "Medium",
                    "warning": "Weak momentum"
                }

        elif trend == "bearish":
            if rsi <= 30:
                return {
                    "bias": "Bearish",
                    "confidence": "Medium",
                    "warning": "Oversold bounce risk"
                }
            elif rsi <= 50:
                return {
                    "bias": "Bearish",
                    "confidence": "High",
                    "warning": "Strong bearish momentum"
                }
            else:
                return {
                    "bias": "Bearish",
                    "confidence": "Medium",
                    "warning": "Possible reversal risk"
                }

        return {
            "bias": "Neutral",
            "confidence": "Low",
            "warning": "No clear signal"
        }

    def explain(self, prompt: str) -> str:
        coin_symbol, chart_symbol = self.detect_symbol(prompt)

        market = self.market.get_coin_data(coin_symbol)
        indicators = self.indicators.analyze(chart_symbol)
        decision = self.calculate_bias(indicators)

        system_prompt = f"""
You are ORACLE, an elite crypto trading analyst.

LIVE MARKET DATA:
Symbol: {market["symbol"]}
Price: ${market["price"]}
24h Change: {market["change_24h"]}%
Market Cap: ${market["market_cap"]}
24h Volume: ${market["volume_24h"]}

TECHNICAL INDICATORS:
EMA20: {indicators["ema20"]}
EMA50: {indicators["ema50"]}
RSI: {indicators["rsi"]}
Trend: {indicators["trend"]}

PRECOMPUTED DECISION:
Market Bias: {decision["bias"]}
Confidence: {decision["confidence"]}
Warning: {decision["warning"]}

RULES:
- Use the live data above
- Respect RSI logic
- RSI > 70 = overbought
- RSI < 30 = oversold
- EMA20 > EMA50 = bullish trend
- EMA20 < EMA50 = bearish trend
- Keep analysis logically consistent
- Give actionable answer
- Be concise

FORMAT:

Market Bias: [Bullish / Bearish / Neutral]
Confidence: [Low / Medium / High]

Technical Snapshot:
RSI: X
EMA20: X
EMA50: X
Trend: X

Key Levels:
Support: X / Y / Z
Resistance: X / Y / Z
Invalidation: X
Target Zone: X - Y

Trader Take:
(short actionable answer)

Risk Factors:
(bullets)
"""

        response = self.client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": system_prompt
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=0.2,
        )

        return response.choices[0].message.content