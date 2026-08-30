import base64
import os
import requests
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form
from sqlalchemy.orm import Session
from pydantic import BaseModel
from openai import OpenAI

from app.db.session import get_db
from app.models.chat import Conversation, Message
from app.models.user import User
from app.core.config import settings
from app.indicators.engine import IndicatorEngine

router = APIRouter()

class MessageCreate(BaseModel):
    user_id: int
    conversation_id: int | None = None
    role: str
    content: str

class ChatRequest(BaseModel):
    prompt: str

# D Daftar koin yang dikenali sistem untuk deteksi otomatis dari prompt pengguna
SUPPORTED_COINS = [
    "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "LINK", 
    "DOT", "SHIB", "LTC", "BCH", "NEAR", "SUI", "RENDER", "PEPE", 
    "MATIC", "UNI", "ICP", "ZEC", "KAS", "TAO", "FTM", "ARB", "OP", "IMX", "STX", "INJ", "ATOM"
]

# 1. MAIN CHAT ENDPOINT (Dynamic Asset & Indicator Extractor)
@router.post("/")
@router.post("")
async def standard_chat(request: ChatRequest):
    api_key = getattr(settings, "OPENAI_API_KEY", None) or os.getenv("OPENAI_API_KEY")
    if not api_key:
        return {"status": "error", "reply": "Kunci API OpenAI tidak ditemukan di backend."}

    # Deteksi otomatis koin apa saja yang disebut oleh user di dalam prompt
    prompt_upper = request.prompt.upper()
    detected_coins = []
    for coin in SUPPORTED_COINS:
        if coin in prompt_upper or coin.lower() in request.prompt.lower():
            detected_coins.append(coin)

    # Fallback jika tidak ada koin spesifik yang terdeteksi
    if not detected_coins:
        detected_coins = ["BTC", "ETH"]
    else:
        detected_coins = list(set(detected_coins))[:3] # Batasi maksimal 3 koin agar respons tetap cepat

    # Tarik data teknikal real-time menggunakan IndicatorEngine (Binance) untuk koin yang diminta
    engine = IndicatorEngine()
    market_contexts = []
    
    for coin in detected_coins:
        pair = f"{coin}/USDT"
        analysis = engine.analyze(pair)
        if analysis:
            market_contexts.append(
                f"Asset: {coin}/USDT | Price: ${analysis['price']} | RSI(14): {analysis['rsi']} | EMA20: {analysis['ema20']} | EMA50: {analysis['ema50']} | Trend: {analysis['trend']}"
            )
        else:
            market_contexts.append(f"Asset: {coin}/USDT | Data sedang disinkronkan.")

    market_context_str = " | ".join(market_contexts)
    injected_label = ", ".join(detected_coins)

    client = OpenAI(api_key=api_key)
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system", 
                    "content": (
                        "You are ORACLE, an elite institutional crypto trading analyst and quantitative portfolio manager. "
                        f"Live Market Data Injected for [{injected_label}]: {market_context_str}. "
                        "Gunakan data teknikal real-time di atas untuk menjawab pertanyaan pengguna secara akurat, tajam, dan mendalam. "
                        "CRITICAL INSTRUCTION: You MUST reply in the EXACT SAME LANGUAGE as the user's prompt. "
                        "Jawab dengan gaya bahasa profesional, analitis, dan layaknya eksekutif Wall Street."
                    )
                },
                {"role": "user", "content": request.prompt}
            ],
            max_tokens=900
        )
        
        ai_reply = response.choices[0].message.content
        
        # Tambahkan label informasi transparan di awal balasan agar UI frontend menampilkan koin apa yang sedang dibaca
        formatted_reply = f"🟢 **LIVE MARKET DATA INJECTED: {injected_label}**\n\n{ai_reply}"

        return {"status": "success", "reply": formatted_reply}
    except Exception as e:
        return {"status": "error", "reply": f"Neural Net Error: {str(e)}"}

# 2. MEMORY ENDPOINT
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

# 3. VISION ENDPOINT
@router.post("/vision")
async def analyze_image(file: UploadFile = File(...), prompt: str = Form(default="")):
    try:
        image_data = await file.read()
        base64_image = base64.b64encode(image_data).decode("utf-8")
        mime_type = file.content_type or "image/jpeg"

        api_key = getattr(settings, "OPENAI_API_KEY", None) or os.getenv("OPENAI_API_KEY")
        
        if not api_key:
            return {
                "status": "error",
                "reply": "**[ORACLE VISION ERROR]** OPENAI_API_KEY belum terdeteksi. Pastikan variabel OPENAI_API_KEY sudah terdaftar di backend/.env"
            }

        client = OpenAI(api_key=api_key)
        user_text = prompt.strip() if prompt.strip() else "Analyze this market chart and provide precise technical breakdown."

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are ORACLE, an elite institutional crypto trading analyst and quantitative architect. "
                        "Examine the attached trading chart image meticulously. "
                        "Read the exact asset symbol directly from the visual text on the chart header. "
                        "Provide your response formatted strictly with these sections:\n\n"
                        "**[ORACLE VISION ANALYSIS]**\n\n"
                        "Berdasarkan pemindaian visual pada chart **[Detected Symbol]/USDT**:\n"
                        "🟢 **Market Bias:** [Bullish/Bearish/Neutral] (Confidence: [XX]%)\n"
                        "📊 **Technical Snapshot:**\n"
                        "- **RSI (14):** [Value] - [Explanation context]\n"
                        "- **EMA 20/50:** [Value] - [Explanation context]\n\n"
                        "🎯 **Trader Take (Long/Short):**\n"
                        "[Actionable institutional execution strategy].\n\n"
                        "CRITICAL INSTRUCTION: You MUST write the ENTIRE explanation, context, and strategy in the EXACT SAME LANGUAGE as the user's prompt. "
                        "If the user asks in Indonesian, ALL descriptions MUST be in professional Indonesian language. Do not mix languages."
                    )
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": user_text
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
            max_tokens=600
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
