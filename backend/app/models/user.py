import enum
from sqlalchemy import Column, Integer, String, Enum, JSON
from sqlalchemy.orm import relationship
from app.db.base import Base
class UserRole(str, enum.Enum):
    FREE = "Free"
    PRO = "Pro"

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    role = Column(Enum(UserRole), default=UserRole.FREE)
    
    # Menyimpan Watchlist dan konfigurasi UI dalam format JSON
    preferences = Column(JSON, default={"watchlist": [], "theme": "dark"}) 
    
    # Relasi ke tabel percakapan
    conversations = relationship("Conversation", back_populates="user", cascade="all, delete-orphan")