import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings

logger = logging.getLogger(__name__)


async def _safe_start(name: str, coro) -> object | None:
    """
    Jalankan startup satu komponen tanpa membiarkan kegagalannya menjatuhkan
    seluruh aplikasi.

    Bug lama: main.py meng-import RssWorker di level modul, dan rss_worker.py
    meng-import feedparser di level modul. feedparser tidak ada di dependencies,
    jadi import gagal -> app tidak pernah boot -> SEMUA endpoint 404 dan
    WebSocket scanner macet di "Menyambung…". Sekarang tiap komponen diisolasi.
    """
    try:
        instance = await coro()
        logger.info("Startup OK: %s", name)
        return instance
    except Exception:
        logger.exception("Startup GAGAL untuk %s — dilewati, app tetap jalan.", name)
        return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan manager: tiap background worker dinyalakan terisolasi. Satu worker
    gagal (mis. jaringan, kunci API kosong) tidak boleh mematikan yang lain
    atau membuat app gagal boot.
    """
    # 1. Store in-process untuk Market Intelligence (Misi 1).
    from app.services.market_intel_store import MarketIntelStore

    app.state.market_intel_store = MarketIntelStore()

    # 2. Scanner hub — 30 aset, RSI14/EMA20/EMA50 dari OHLCV (Misi 2).
    async def _start_scanner():
        from app.api.routes.scanner import ScannerHub

        hub = ScannerHub(redis_client=getattr(settings, "redis", None))
        await hub.start()
        return hub

    app.state.scanner_hub = await _safe_start("scanner_hub", _start_scanner)

    # 3. RSS worker — Alpha News Feed (Misi 1).
    async def _start_rss():
        from app.workers.rss_worker import RssWorker

        worker = RssWorker(
            store=app.state.market_intel_store,
            redis_client=getattr(settings, "redis", None),
            supabase=getattr(settings, "supabase", None),
            poll_interval=settings.rss_poll_seconds,
        )
        await worker.start()
        return worker

    app.state.rss_worker = await _safe_start("rss_worker", _start_rss)

    # 4. On-chain worker — whale > $500k (Misi 1).
    async def _start_onchain():
        from app.workers.onchain_worker import OnChainWorker

        worker = OnChainWorker(
            store=app.state.market_intel_store,
            rpc_url=settings.eth_rpc_url,
            threshold_usd=settings.whale_threshold_usd,
            poll_interval=settings.onchain_poll_seconds,
            redis_client=getattr(settings, "redis", None),
            supabase=getattr(settings, "supabase", None),
        )
        await worker.start()
        return worker

    app.state.onchain_worker = await _safe_start("onchain_worker", _start_onchain)

    # 5. Dual-Model AI Router (Misi 3 & 4) — reasoning engine dibuat lazy,
    #    router sendiri murah untuk diinstansiasi.
    async def _start_ai_router():
        from app.ai.router import AIModelRouter

        hub = app.state.scanner_hub
        engine = hub.engine if hub is not None else None
        return AIModelRouter(store=app.state.market_intel_store, indicator_engine=engine)

    app.state.ai_router = await _safe_start("ai_router", _start_ai_router)

    try:
        yield
    finally:
        for name in ("scanner_hub", "rss_worker", "onchain_worker"):
            component = getattr(app.state, name, None)
            if component is not None and hasattr(component, "stop"):
                try:
                    await component.stop()
                except Exception:
                    logger.exception("Shutdown %s gagal.", name)
        ai_router = getattr(app.state, "ai_router", None)
        if ai_router is not None and hasattr(ai_router, "aclose"):
            try:
                await ai_router.aclose()
            except Exception:
                logger.exception("Shutdown ai_router gagal.")


app = FastAPI(title=settings.project_name, version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.backend_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.api_v1_prefix)


@app.get("/health", tags=["health"])
async def health() -> dict[str, object]:
    """Cek cepat: app hidup + status tiap worker."""
    return {
        "status": "ok",
        "service": "oracle-backend",
        "workers": {
            "scanner_hub": getattr(app.state, "scanner_hub", None) is not None,
            "rss_worker": getattr(app.state, "rss_worker", None) is not None,
            "onchain_worker": getattr(app.state, "onchain_worker", None) is not None,
            "ai_router": getattr(app.state, "ai_router", None) is not None,
        },
    }
