from fastapi import APIRouter
from pydantic import BaseModel
from app.ai.explainer import AIExplanationService

router = APIRouter()


class AIRequest(BaseModel):
    prompt: str


@router.post("/chat")
def ai_chat(request: AIRequest):
    service = AIExplanationService()
    reply = service.explain(request.prompt)
    return {"reply": reply}