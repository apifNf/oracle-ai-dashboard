from enum import StrEnum


class SignalAction(StrEnum):
    WATCH = "watch"
    AVOID = "avoid"
    REVIEW = "review"


def rsi_rule(rsi: float) -> SignalAction:
    if rsi < 30:
        return SignalAction.REVIEW
    if rsi > 70:
        return SignalAction.AVOID
    return SignalAction.WATCH
