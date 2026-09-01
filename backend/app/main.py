from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Impor router dan konfigurasi internal (PASTI VALID)
from app.api.router import api_router
from app.core.config import settings

# Impor background workers dari Claude Opus 5 (PASTI VALID)
from app.api.routes.scanner import ScannerHub
from app.workers.rss_worker import RssWorker


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Asynchronous Lifespan Manager: Mengontrol siklus hidup (startup/shutdown)
    seluruh background worker otonom platform ORACLE secara simultan.
    """
    # Mengambil instance Redis dan Supabase dari settings atau menginstansiasinya secara aman
    # Sesuai catatan Opus 5: Jangan membuat instance baru per request, lewatkan client yang sudah ada.
    # Jika proyek Anda menyimpan client di settings, gunakan settings.redis_client, jika tidak, panggil client global Anda.
    
    # 1. Mengaktifkan mesin pemantau 30 aset bursa tanpa rest rate limit
    app.state.scanner_hub = ScannerHub(redis_client=getattr(settings, "redis", None))
    await app.state.scanner_hub.start()
    
    # 2. Mengaktifkan pekerja intelijen umpan berita makro terdeduplikasi
    app.state.rss_worker = RssWorker(
        redis_client=getattr(settings, "redis", None), 
        supabase=getattr(settings, "supabase", None)
    )
    await app.state.rss_worker.start()
    
    yield
    
    # 3. Mematikan seluruh koneksi worker secara aman saat server dimatikan (Graceful Shutdown)
    await app.state.scanner_hub.stop()
    await app.state.rss_worker.stop()


# Inisialisasi aplikasi FastAPI dengan mendaftarkan konteks lifespan di atas
app = FastAPI(
    title=settings.project_name, 
    version="0.1.0",
    lifespan=lifespan
)

# Konfigurasi keamanan lintas domain (CORS Guardrails)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.backend_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registrasi jalur endpoint utama routing API v1
app.include_router(api_router, prefix=settings.api_v1_prefix)
