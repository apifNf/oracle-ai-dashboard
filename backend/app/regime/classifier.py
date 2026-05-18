from enum import StrEnum


class MarketRegime(StrEnum):
    TRENDING_UP = "trending_up"
    TRENDING_DOWN = "trending_down"
    RANGE_BOUND = "range_bound"
    UNKNOWN = "unknown"


def classify_regime(close: float, moving_average: float) -> MarketRegime:
    if close > moving_average:
        return MarketRegime.TRENDING_UP
    if close < moving_average:
        return MarketRegime.TRENDING_DOWN
    return MarketRegime.RANGE_BOUND
