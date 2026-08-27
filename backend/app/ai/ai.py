from fastapi import APIRouter
from pydantic import BaseModel
from app.ai.explainer import AIExplanationService
import requests
import re

router = APIRouter()

class AIRequest(BaseModel):
    prompt: str

def get_crypto_price(symbol: str) -> str:
    """
    Fungsi mata-mata: Menyedot harga koin real-time dari Binance Public API.
    """
    try:
        # Binance API untuk mendapatkan harga koin (contoh: BTCUSDT)
        url = f"https://api.binance.com/api/v3/ticker/price?symbol={symbol.upper()}USDT"
        response = requests.get(url, timeout=3)
        if response.status_code == 200:
            data = response.json()
            return f"Harga {symbol.upper()} saat ini: ${float(data['price']):.5f} USDT"
        return ""
    except Exception:
        return ""

def extract_symbols(text: str) -> list:
    """
    Fungsi radar: Mendeteksi nama koin di dalam ketikan user.
    """
    # penCarian kata yang terdiri dari 2-6 huruf kapital
    matches = re.findall(r'\b[A-Z]{2,6}\b', text.upper())
    
    # Filter kata umum guna radar tidak salah membaca
    ignore_words = [
        "APA", "BAGAIMANA", "TOLONG", "ANALISA", "KOIN", "HARI", "INI", 
        "KIRA", "DONG", "YANG", "DAN", "PROSPEK", "MARKET", "HARGA", "KAPAN", "NAIK", "TURUN"
    ]
    symbols = [m for m in matches if m not in ignore_words]
    
    return list(set(symbols))

@router.post("/chat")
def ai_chat(request: AIRequest):
    # 1. Radar mendeteksi apa yang ditanyakan user
    detected_symbols = extract_symbols(request.prompt)
    
    # 2. Dynamic Fetching: Sedot data market real-time 
    realtime_context = ""
    if detected_symbols:
        context_pieces = []
        for sym in detected_symbols:
            price_info = get_crypto_price(sym)
            if price_info:
                context_pieces.append(price_info)
        
        if context_pieces:
            realtime_context = "Data Real-Time Market Otomatis:\n" + "\n".join(context_pieces) + "\n\n"

    # 3. Prompt Engineering Injection
    if realtime_context:
        enhanced_prompt = (
            f"=== KONTEKS SISTEM ===\n{realtime_context}======================\n\n"
            f"Sebagai analis kripto ORACLE, jawab pertanyaan user berikut menggunakan data real-time di atas jika relevan:\n"
            f"User: {request.prompt}"
        )
    else:
        enhanced_prompt = request.prompt

    # 4. Kirim mega-prompt ke Otak Utama (LLM)
    service = AIExplanationService()
    reply = service.explain(enhanced_prompt)
    
    # Kembalikan jawaban ke frontend, lengkap dengan info koin apa yang berhasil dideteksi
    return {
        "reply": reply,
        "context_injected": bool(realtime_context),
        "detected_symbols": detected_symbols
    }