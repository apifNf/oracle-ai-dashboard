import pandas as pd
import pandas_ta as ta


def add_rsi(frame: pd.DataFrame, length: int = 14) -> pd.DataFrame:
    result = frame.copy()
    result["rsi"] = ta.rsi(result["close"], length=length)
    return result
