from fastapi import APIRouter, Depends, HTTPException, File, UploadFile
from sqlalchemy.orm import Session
from pydantic import BaseModel
import base64

from app.db.session import get_db 
from app.models.chat import Conversation, Message
from app.models.user import User

router = APIRouter()

# Schema Pydantic untuk menerima data dari Frontend
class MessageCreate(BaseModel):
    user_id: int
    conversation_id: int | None = None
    role: str
    content: str

@router.post("/memory")
def save_chat_memory(data: MessageCreate, db: Session = Depends(get_db)):
    # 1. Cek User (Role-Based Logic preparation)
    user = db.query(User).filter(User.id == data.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # 2. Buat Conversation baru jika belum ada (AI Memory History)
    if not data.conversation_id:
        new_conv = Conversation(user_id=data.user_id, title="Analisis Baru")
        db.add(new_conv)
        db.commit()
        db.refresh(new_conv)
        conv_id = new_conv.id
    else:
        conv_id = data.conversation_id

    # 3. Simpan Pesan ke Database
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
    # 1. Membaca gambar yang di-upload dari frontend
    image_data = await file.read()
    
    # 2. Mengubah gambar menjadi format Base64 
    # (format standar yang diwajibkan oleh OpenAI/Gemini API)
    base64_image = base64.b64encode(image_data).decode('utf-8')
    
    # kode untuk mengirim base64_image ke AI
    
    return {
        "status": "success", 
        "filename": file.filename, 
        "message": "Gambar berhasil ditangkap dan siap dianalisis oleh AI!"
    }