from fastapi import APIRouter

from app.api.routes.ai import router as ai_router          # /chat (explainer legacy)
from app.api.routes.ai_router import router as ai_model_router  # /ai/route (Misi 3 & 4)
from app.api.routes.scanner import router as scanner_router
from app.api.routes.chat import router as chat_router      # Jalur memori AI
from app.api.v1.market_intel import router as market_intel_router  # Misi 1

api_router = APIRouter()

api_router.include_router(ai_router)
api_router.include_router(ai_model_router)
api_router.include_router(scanner_router)
api_router.include_router(chat_router, prefix="/chat", tags=["Chat Memory"])
api_router.include_router(market_intel_router)
