# CLAUDE.md — ORACLE AI Crypto

Panduan arsitektur permanen untuk agen/kontributor. Baca ini sebelum menyentuh
backend atau frontend.

> ORACLE adalah **dashboard analis** crypto, **bukan bot auto-trading**. Semua
> output AI (termasuk JSON FABLE 5) adalah **proposal untuk direview manusia**.
> Eksekusi order ke exchange bersifat manual dan **tidak** di-wire di codebase ini.
> Jangan menambahkan pemanggilan order exchange nyata tanpa keputusan eksplisit
> pemilik proyek. Disclaimer risiko di UI tidak boleh dihapus.

## Layout

```
backend/   FastAPI (Python 3.11+), SQLAlchemy, Pydantic v2
frontend/  Next.js 14 (App Router), TypeScript, Tailwind, Supabase auth
```

Jalankan: `docker compose --env-file .env up --build`
Backend :8000 · Frontend :3000 · Health `GET http://localhost:8000/health`

Backend lokal tanpa Docker:
```
cd backend && python -m venv .venv && . .venv/bin/activate
pip install -e .            # WAJIB — lihat "Dependency" di bawah
uvicorn app.main:app --reload
```

## Prinsip yang tidak bisa ditawar

1. **Jangan pernah mengembalikan angka karangan.** Kegagalan sumber data
   diwakili lewat field `status` (`ok|stale|pending|unavailable|degraded|empty`),
   bukan `price=0` atau `rsi=50`. `IndicatorEngine` menolak (`_refusal`) alih-alih
   menebak.
2. **Indikator dihitung dari candle yang SUDAH close**, bukan dari tick ticker.
3. **Sinyal bersifat deterministik & bisa diaudit** (`ema_cross_rsi_v1`). Tidak
   ada "confidence 80%". Yang dilaporkan: kriteria mana yang terpenuhi.
4. **Allowlist untuk semua sumber eksternal.** Jangan terima URL feed / RPC dari
   input user (SSRF).
5. **Lifespan terisolasi.** Satu worker gagal start tidak boleh menjatuhkan app
   (lihat `_safe_start` di `app/main.py`). Ini regresi yang pernah terjadi:
   `feedparser` hilang dari deps → `import` gagal → seluruh app 404.

## Backend — peta modul

| Area | File | Catatan |
|---|---|---|
| Entrypoint & lifespan | `app/main.py` | `_safe_start` per worker; `GET /health` |
| Routing agregat | `app/api/router.py` | semua sub-router di-mount di `settings.api_v1_prefix` (`/api/v1`) |
| Config | `app/core/config.py` | pydantic-settings, `.env`, `extra="ignore"` |
| Indikator | `app/indicators/engine.py` | `IndicatorEngine.analyze()` — RSI14 Wilder, EMA20/50, multi-source (Binance→Gate.io), gerbang status pasar |
| Scanner | `app/api/routes/scanner.py` | `ScannerHub` (1 hitungan → banyak klien), stream WS Binance, broadcast tiap 5s |
| Market data | `app/services/market_data.py` | CoinGecko, cache-first, batching |
| Kredensial exchange | `app/services/crypto_vault.py`, `exchange_credentials.py` | AES-256-GCM, AAD terikat (user,exchange,field). Plaintext tak pernah di-log/response |

### Misi 1 — Market Intelligence

- **Store**: `app/services/market_intel_store.py` — ring buffer in-process
  (`MarketIntelStore` di `app.state.market_intel_store`). Dipilih karena deploy
  saat ini **tidak** menjalankan Redis/Supabase dan paket kliennya tidak
  terpasang. Redis/Supabase = mirror **opsional** di worker, bukan syarat.
- **RSS**: `app/workers/rss_worker.py` — `RssWorker` menarik RSS XML publik
  (allowlist `DEFAULT_FEEDS`), feedparser di executor, conditional GET (ETag),
  klasifikasi `impact` berbasis kata kunci transparan (boleh `null`).
- **On-chain**: `app/workers/onchain_worker.py` — `OnChainWorker` polling
  JSON-RPC Ethereum publik (`settings.eth_rpc_url`), scan transfer ETH native,
  konversi ke USD via harga spot Binance, emit transfer ≥ `settings.whale_threshold_usd`
  (default $500k). Hanya ETH native (transfer ERC-20 = event log, di luar cakupan v1).
- **Endpoint** (`app/api/v1/market_intel.py`, prefix `/market-intel`):
  - `GET /api/v1/market-intel/news?limit=`
  - `GET /api/v1/market-intel/onchain?limit=`
  - `GET /api/v1/market-intel/health`
  - `POST /api/v1/market-intel/webhooks/alchemy` (opsional; butuh `ALCHEMY_WEBHOOK_SIGNING_KEY`)
- **Envelope respons** (frontend membaca `status`, bukan panjang array):
  `{ status: "ok"|"empty"|"degraded", data: [], count, as_of, error }`
- Frontend `frontend/app/market-intelligence/page.tsx` memanggil URL **absolut**
  `${NEXT_PUBLIC_API_BASE_URL}/api/v1/market-intel/...` (dulu relatif → 404).

### Misi 2 — Live Signal Scanner

- WS: `GET /api/v1/ws/scanner` (satu arah, server→klien). Snapshot dibangun sekali
  di `ScannerHub`, dibroadcast ke semua klien — jumlah klien tidak menambah beban
  ke Binance.
- REST: `GET /api/v1/scanner/signals`, `GET /api/v1/scanner/health`.
- **`GET /api/v1/scanner/detail/{coin}?interval=15m|1h|4h|1d`** — detail per aset
  untuk panel chart kartu (sebelumnya tidak ada → panel 404). Memakai
  `hub.engine` (klien httpx yang sama).
- 30 pasangan di `SCANNER_PAIRS`. Simbol delisted membuat batch `/ticker/24hr`
  gagal total — divalidasi lewat `exchangeInfo` sebelum stream dibuka.
- Status kartu (`ok/stale/pending/unavailable/insufficient_history/...`)
  ditampilkan apa adanya; "N/A" hanya muncul kalau indikator memang tidak
  dihitung, dengan alasan tertulis.

### Misi 3 — Dual-Model AI Router

`app/ai/router.py` :: `AIModelRouter` (`app.state.ai_router`).

| Tier | Engine | Kapan |
|---|---|---|
| **TIER 1** Conversational | GPT-4o (`settings.tier1_model`) — `app/ai/tier1.py` | default: sapaan, tanya umum, istilah dasar |
| **TIER 2** Quant Core "FABLE 5" | Claude Sonnet/Opus (`settings.fable5_model`) — `app/ai/fable5.py` | lihat pemicu ↓ |

Switch ke **FABLE 5** bila salah satu benar:
- flag `execute_trade` (tombol "Execute Trade") atau `copy_trading_pilot`
  ("Copy-Trading Pilot");
- `risk_params` terisi (parameter risiko/order eksekusi);
- prompt memuat kata kunci order (`leverage`, `margin`, `TP`, `SL`, `entry`,
  `position size`, …) — `_ORDER_PARAM_HINTS`;
- prompt minta analisa mendalam / proyeksi struktur teknikal / analisa
  portofolio — `_DEEP_ANALYSIS_HINTS`.

Keputusan tier bisa diintip tanpa memanggil model: `POST /api/v1/ai/route/preview`.

**Endpoint:**
- `POST /api/v1/ai/route` — body `{ prompt, execute_trade?, copy_trading_pilot?, symbol?, risk_params?, history? }`.
  TIER 1 → `{ tier:1, reply }`. TIER 2 → `{ tier:2, decision: <JSON FABLE 5 tervalidasi> }`.
- `POST /api/v1/ai/route/preview` — hanya `{ tier, routed_because }`.
- `GET /api/v1/ai/fable5/system` — system instruction FABLE 5 yang aktif.

### Misi 4 — System Prompt & Enforcement JSON FABLE 5

`app/ai/fable5.py`:
- `FABLE5_SYSTEM_INSTRUCTION` — disimpan **verbatim** (Pilar A–D). Ditambah
  `_JSON_ENFORCEMENT_RIDER` (kontrak output yang ditegakkan server).
- **Skema wajib** = model pydantic `Fable5Decision` (`execution_status`,
  `decision_reasoning`, `order_payload{…}`, `risk_assessment{…}`).
- **Enforcement**: parse objek JSON pertama yang seimbang → validasi pydantic →
  bila gagal, **1× retry korektif** → bila masih gagal, kembalikan envelope
  `DENIED` terstruktur (`_denied`). Handler **tidak pernah** melempar 500 untuk
  ketidakpatuhan model.
- **Pilar D (anti-halusinasi)**: RSI/EMA riil diambil `AIModelRouter._live_metrics()`
  dari `IndicatorEngine`. Bila kosong → kalimat wajib
  `"Live metrics for this asset are currently under terminal synchronization."`
  (`SYNC_SENTINEL`) — bukan angka karangan.
- **Pilar A**: konteks makro (RSS) + whale (>$500k) dari `MarketIntelStore`.
- **Pilar B**: caps (≤2.0% equity, leverage 1–3, layered TP, structural SL)
  diinstruksikan ke model; `applied_leverage` di-clamp lewat skema (int).

Model Claude: default `claude-sonnet-5`, ubah via env `FABLE5_MODEL`
(mis. `claude-opus-5`). Thinking adaptif. Butuh `ANTHROPIC_API_KEY` + paket
`anthropic`; jika absen, TIER 2 mengembalikan `DENIED` "engine unavailable"
(degraded), bukan crash.

## Dependency (WAJIB diperhatikan)

`backend/pyproject.toml` — ditambahkan: `anthropic`, `feedparser`, `httpx`
(eksplisit), `websockets` (eksplisit). Setelah pull, **`pip install -e backend`**.
Import di level modul (`feedparser`, `anthropic`, `openai`, `websockets`) — kalau
salah satu hilang, komponen terkait nonaktif tapi app tetap boot (guard `try/except`
di worker + `_safe_start` di lifespan).

## Environment (`.env`, tidak di-commit — `.gitignore`)

```
OPENAI_API_KEY=          # TIER 1 + explainer + vision
ANTHROPIC_API_KEY=       # TIER 2 FABLE 5
BINANCE_API_KEY/SECRET=  # tidak dipakai untuk order; hanya kalau nanti butuh endpoint privat
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
# opsional:
FABLE5_MODEL=claude-sonnet-5
TIER1_MODEL=gpt-4o
WHALE_THRESHOLD_USD=500000
ETH_RPC_URL=https://ethereum-rpc.publicnode.com
ALCHEMY_WEBHOOK_SIGNING_KEY=
```

> Kunci di `.env` bersifat rahasia. Kalau repo/working tree pernah dibagikan,
> **rotasi** semua kunci (OpenAI, Anthropic, Binance, Supabase service role).

## Konvensi

- Komentar & pesan log: Bahasa Indonesia (ikuti gaya file sekitarnya).
- Semua I/O jaringan async (`httpx.AsyncClient`); yang sinkron & berat
  (`feedparser`) → `run_in_executor`.
- Jangan buat `httpx.AsyncClient` / `OpenAI` / `Anthropic` per request — reuse
  instance di `app.state` / service.
- Frontend: panggil backend lewat `process.env.NEXT_PUBLIC_API_BASE_URL` (absolut),
  jangan URL relatif.
