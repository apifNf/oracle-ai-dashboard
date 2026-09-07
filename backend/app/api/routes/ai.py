from fastapi import APIRouter
from pydantic import BaseModel
from app.ai.explainer import AIExplanationService
import requests
import re

router = APIRouter()

class AIRequest(BaseModel):
    prompt: str

def get_crypto_price(symbol: str) -> dict:
    """
    Fungsi mata-mata yang sudah di-upgrade dengan sistem Diagnostik.
    Sumber: Bybit v5 (spot). Binance memblokir IP AS (HTTP 451) di Render.
    """
    try:
        url = (
            "https://api.bybit.com/v5/market/tickers"
            f"?category=spot&symbol={symbol.upper()}USDT"
        )
        response = requests.get(url, timeout=5)

        if response.status_code == 200:
            body = response.json()
            rows = (body.get("result") or {}).get("list") or []
            if not rows:
                return {"status": "failed", "text": "", "debug": "Simbol tidak ada di Bybit"}
            price = float(rows[0]["lastPrice"])
            return {
                "status": "success",
                "text": f"Harga {symbol.upper()} saat ini: ${price:.5f} USDT",
                "debug": "Sukses (200 OK)"
            }
        else:
            return {
                "status": "failed", 
                "text": "",
                "debug": f"Ditolak Server: HTTP {response.status_code} - {response.text}"
            }
    except Exception as e:
        return {
            "status": "error", 
            "text": "",
            "debug": f"Sistem Error/Blokir ISP: {str(e)}"
        }

def extract_symbols(text: str) -> list:
    matches = re.findall(r'\b[A-Z]{2,6}\b', text)
    ignore_words = ["APA", "TOLONG", "KOIN", "HARI", "INI", "DONG", "YANG", "DAN", "BELI", "ATAU", "JUAL"]
    symbols = [m for m in matches if m not in ignore_words]
    return list(set(symbols))

@router.post("/chat")
def ai_chat(request: AIRequest):
    detected_symbols = extract_symbols(request.prompt)
    
    realtime_context = ""
    debug_logs = []  # Menampung hasil investigasi jaringan
    
    if detected_symbols:
        context_pieces = []
        for sym in detected_symbols:
            hasil = get_crypto_price(sym)
            debug_logs.append(f"{sym}: {hasil['debug']}")
            
            if hasil["status"] == "success":
                context_pieces.append(hasil["text"])
        
        if context_pieces:
            realtime_context = "Data Real-Time Market Otomatis:\n" + "\n".join(context_pieces) + "\n\n"

    if realtime_context:
        enhanced_prompt = (
            f"=== KONTEKS SISTEM ===\n{realtime_context}======================\n\n"
            f"Sebagai analis kripto ORACLE, jawab pertanyaan user berikut menggunakan data real-time di atas jika relevan:\n"
            f"User: {request.prompt}"
        )
    else:
        enhanced_prompt = request.prompt

    service = AIExplanationService()
    reply = service.explain(enhanced_prompt)
    
    return {
        "reply": reply,
        "context_injected": bool(realtime_context),
        "detected_symbols": detected_symbols,
        "network_debug": debug_logs  # Menampilkan pesan rahasia di Swagger UI
    }