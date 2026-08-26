# ORACLE

ORACLE is an enterprise-grade AI crypto trading analyst dashboard. It is designed to provide institutional-level market intelligence, dynamic on-chain data streaming, deterministic rule-based signal review, and AI-assisted market explanations.

ORACLE is not a black-box auto-trading bot. The platform focuses exclusively on the cryptocurrency market, facilitating manual trade execution while leveraging AI as an advanced explanation and analysis layer rather than a mere prediction engine. It equips traders with the intelligence of a Wall Street desk, wrapped in a highly polished, Silicon Valley-inspired UI.

## Tech Stack

*   **Frontend:** Next.js 14, TypeScript, Tailwind CSS, Lucide Icons
*   **Charting Library:** TradingView Lightweight Charts (Embedded Signal Charts)
*   **UI/UX:** Dynamic Premium Dark & Crisp Light Mode themes
*   **Backend:** Python 3.11, FastAPI, SQLAlchemy, Alembic, Pydantic (Architecture Ready)
*   **Database:** PostgreSQL
*   **Market Data APIs:** CryptoCompare (News Sentiment), CryptoAPIs (Mainnet Ethereum On-Chain Data), CCXT/Binance API (Market Data)
*   **Analytics:** pandas, numpy, pandas-ta
*   **AI Integration:** OpenAI API / Custom LLM placeholder (In Development)
*   **Deployment:** Vercel (Frontend edge-hosting)

## Key Features (MVP)

*   **Premium Dashboard Shell:** A responsive, state-of-the-art interface featuring seamless transitions between deep Dark mode and crisp Light mode, optimized for extended professional analysis.
*   **Live Signal Scanner:** Real-time deterministic market screening across major assets (BTC, ETH, SOL, BNB, ADA, XRP). Features embedded TradingView candlestick charts, automated signal generation (LONG/SHORT), and live technical indicator tracking (RSI 14, EMA 20/50, Market Trend, Confidence scoring).
*   **Market Intelligence Module:**
    *   **Alpha News Feed:** Real-time news aggregation powered by a custom smart keyword-based sentiment engine. It automatically scans titles and tags to classify global market impacts as `BULLISH`, `BEARISH`, or `IMPORTANT`.
    *   **Live On-Chain Stream:** Institutional-grade hybrid data stream displaying live Ethereum mainnet block indexing and curated high-volume whale transaction tracking (Binance, Uniswap, Coinbase routing). Built with robust 402/Rate-Limit fallback handling to ensure 100% uptime.
*   **AI Chat Assistant:** (Upcoming) Interactive AI for deep-dive analysis and trade explanations.
*   **Trading Journal:** (Upcoming) Integrated context logging for trade review.
*   **Robust Backend Architecture:** Typed configurations, SQLAlchemy session management, and modular domains for services, indicators, regimes, signals, and AI.

## Project Structure

```text
oracle/
├── backend/
│   ├── alembic/
│   ├── app/
│   │   ├── api/
│   │   ├── ai/
│   │   ├── core/
│   │   ├── db/
│   │   ├── indicators/
│   │   ├── models/
│   │   ├── regime/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── signals/
│   ├── Dockerfile
│   ├── alembic.ini
│   └── pyproject.toml
├── frontend/
│   ├── app/
│   ├── components/
│   ├── hooks/
│   ├── lib/
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
├── .env.example
└── README.md
```

## Local Development & Setup

**1. Environment Configuration:**
Copy the example environment file and configure your API keys.

```bash
cp .env.example .env
```

*Required Keys:*
* `CRYPTO_NEWS_API_KEY`: For CryptoCompare news aggregation.
* `CRYPTO_APIS_KEY`: For live Ethereum mainnet indexing.

**2. Run via Docker Compose:**

```bash
docker compose --env-file .env up --build
```

**Active Services:**
*   **Frontend:** `http://localhost:3000` (or active Vercel production domain)
*   **Backend (FastAPI):** `http://localhost:8000`
*   **Backend Health Check:** `http://localhost:8000/health`

## Architectural Notes

*   **Deterministic Foundation:** Trading logic and indicators are strictly deterministic and rule-based.
*   **AI Philosophy:** AI output is designed to explain evidence, present context, and analyze sentiment, not to blindly predict future prices.
*   **Fault Tolerance:** External API calls are wrapped in robust fallback mechanisms to guarantee seamless UI performance even during vendor rate limits.
