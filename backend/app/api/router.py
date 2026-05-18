from fastapi import APIRouter
from app.api.routes.ai import router as ai_router
from app.api.routes.scanner import router as scanner_router

api_router = APIRouter()

api_router.include_router(ai_router)
api_router.include_router(scanner_router)