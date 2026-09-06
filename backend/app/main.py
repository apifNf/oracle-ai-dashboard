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

    # 1b. Trade Execution Engine + store (Tugas 2).
    from app.services.trade_store import TradeStore

    app.state.trade_store = TradeStore(
        settings.trade_store_path, settings.paper_start_balance_usdt
    )

    # 1c. Monetisasi: user tier store + billing (Coinbase Commerce).
    from app.services.user_store import UserStore
    from app.services.billing_store import BillingStore
    from app.services.billing_service import BillingService

    app.state.user_store = UserStore(
        settings.user_store_path, settings.free_prompt_daily_limit
    )
    app.state.billing_store = BillingStore(settings.billing_store_path)
    app.state.billing_service = BillingService(
        app.state.user_store, app.state.billing_store
    )

    # 2. Scanner hub — 30 aset, RSI14/EMA20/EMA50 dari OHLCV (Misi 2).
    async def _start_scanner():
        from app.api.routes.scanner import ScannerHub

        hub = ScannerHub(redis_client=getattr(settings, "redis", None))
        await hub.start()
        return hub

    app.state.scanner_hub = await _safe_start("scanner_hub", _start_scanner)

    # 3. News worker — Alpha News Feed real-time (CryptoCompare -> RSS fallback).
    async def _start_news():
        from app.workers.news_worker import NewsWorker

        worker = NewsWorker(
            store=app.state.market_intel_store,
            poll_interval=settings.news_poll_seconds,
        )
        await worker.start()
        return worker

    app.state.news_worker = await _safe_start("news_worker", _start_news)

    # 4a. On-chain worker — transfer ETH/ERC-20 on-chain sungguhan (JSON-RPC).
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

    # 4b. Whale-trade worker — eksekusi whale real-time via WebSocket Binance.
    async def _start_whale_trades():
        from app.workers.whale_trade_worker import WhaleTradeWorker

        worker = WhaleTradeWorker(
            store=app.state.market_intel_store,
            threshold_usd=settings.whale_threshold_usd,
        )
        await worker.start()
        return worker

    app.state.whale_trade_worker = await _safe_start("whale_trade_worker", _start_whale_trades)

    # 5. Dual-Model AI Router (Misi 3 & 4) — reasoning engine dibuat lazy,
    #    router sendiri murah untuk diinstansiasi.
    async def _start_ai_router():
        from app.ai.router import AIModelRouter

        hub = app.state.scanner_hub
        engine = hub.engine if hub is not None else None
        return AIModelRouter(
            store=app.state.market_intel_store,
            indicator_engine=engine,
            scanner_hub=hub,
            user_store=app.state.user_store,
        )

    app.state.ai_router = await _safe_start("ai_router", _start_ai_router)

    # 6. Trade engine — pakai IndicatorEngine & ticker hub untuk harga acuan.
    async def _start_trade_engine():
        from app.services.trade_engine import TradeEngine

        hub = app.state.scanner_hub
        engine = hub.engine if hub is not None else None
        return TradeEngine(indicator_engine=engine, scanner_hub=hub)

    app.state.trade_engine = await _safe_start("trade_engine", _start_trade_engine)

    try:
        yield
    finally:
        for name in ("scanner_hub", "news_worker", "onchain_worker", "whale_trade_worker"):
            component = getattr(app.state, name, None)
            if component is not None and hasattr(component, "stop"):
                try:
                    await component.stop()
                except Exception:
                    logger.exception("Shutdown %s gagal.", name)
        trade_engine = getattr(app.state, "trade_engine", None)
        if trade_engine is not None and hasattr(trade_engine, "aclose"):
            try:
                await trade_engine.aclose()
            except Exception:
                logger.exception("Shutdown trade_engine gagal.")
        billing_service = getattr(app.state, "billing_service", None)
        if billing_service is not None and hasattr(billing_service, "aclose"):
            try:
                await billing_service.aclose()
            except Exception:
                logger.exception("Shutdown billing_service gagal.")
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
            "news_worker": getattr(app.state, "news_worker", None) is not None,
            "onchain_worker": getattr(app.state, "onchain_worker", None) is not None,
            "whale_trade_worker": getattr(app.state, "whale_trade_worker", None) is not None,
            "ai_router": getattr(app.state, "ai_router", None) is not None,
            "trade_engine": getattr(app.state, "trade_engine", None) is not None,
            "billing_service": getattr(app.state, "billing_service", None) is not None,
        },
    }
