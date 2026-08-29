import base64
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile
from sqlalchemy.orm import Session
from pydantic import BaseModel
import os

from openai import OpenAI

from app.db.session import get_db
from app.models.chat import Conversation, Message
from app.models.user import User
from app.core.config import settings

router = APIRouter()

class MessageCreate(BaseModel):
    user_id: int
    conversation_id: int | None = None
    role: str
    content: str

@router.post("/memory")
def save_chat_memory(data: MessageCreate, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == data.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not data.conversation_id:
        new_conv = Conversation(user_id=data.user_id, title="Analisis Baru")
        db.add(new_conv)
        db.commit()
        db.refresh(new_conv)
        conv_id = new_conv.id
    else:
        conv_id = data.conversation_id

    new_message = Message(
        conversation_id=conv_id,
        role=data.role,
        content=data.content
    )
    db.add(new_message)
    db.commit()
    
    return {"status": "success", "conversation_id": conv_id, "message": "Memory saved"}

@router.post("/vision")
async def analyze_image(file: UploadFile = File(...)):
    try:
        image_data = await file.read()
        base64_image = base64.b64encode(image_data).decode("utf-8")
        mime_type = file.content_type or "image/jpeg"

        # Mengambil API Key langsung dari file konfigurasi settings aplikasi atau fallback ke os.getenv
        api_key = getattr(settings, "OPENAI_API_KEY", None) or os.getenv("OPENAI_API_KEY")
        
        if not api_key:
            return {
                "status": "error",
                "reply": "**[ORACLE VISION ERROR]** OPENAI_API_KEY belum terdeteksi. Pastikan variabel OPENAI_API_KEY sudah terdaftar di backend/.env"
            }

        client = OpenAI(api_key=api_key)

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are ORACLE, an elite institutional crypto trading analyst and quantitative architect. "
                        "Examine the attached trading chart image meticulously. "
                        "Read the exact asset symbol (e.g., ETH/USDT, BTC/USDT, SOL/USDT) directly from the visual text on the chart header. Do not hallucinate or reuse previous symbols. "
                        "Provide your response formatted strictly with these headers:\n\n"
                        "**[ORACLE VISION ANALYSIS]**\n\n"
                        "Berdasarkan pemindaian visual pada chart **[Detected Symbol]/USDT**:\n"
                        "🟢 **Market Bias:** [Bullish/Bearish/Neutral] (Confidence: [XX]%)\n"
                        "📊 **Technical Snapshot:**\n"
                        "- **RSI (14):** [Extracted value & momentum context]\n"
                        "- **EMA 20/50:** [Extracted values and support/resistance behavior]\n\n"
                        "🎯 **Trader Take (Long/Short):**\n"
                        "[Actionable institutional execution strategy with precise levels]."
                    )
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Analyze this market chart and provide precise technical breakdown."
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{base64_image}"
                            }
                        }
                    ]
                }
            ],
            max_tokens=500
        )

        reply_text = response.choices[0].message.content

        return {
            "status": "success", 
            "reply": reply_text
        }
        
    except Exception as e:
        return {
            "status": "error", 
            "reply": f"Gangguan pada saraf optik AI: {str(e)}"
        }