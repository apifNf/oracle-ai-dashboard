from fastapi import APIRouter

router = APIRouter()

@router.get("/dashboard")
def get_dashboard():
    return {
        "market_regime": "Neutral",
        "active_signals": 3,
        "journal_count": 0,
        "ai_notes": "ORACLE online and receiving market data"
    }