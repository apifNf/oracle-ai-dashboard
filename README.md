# ORACLE

ORACLE is a personal AI crypto trading analyst dashboard. It is designed for market scanning, deterministic rule-based signal review, trading journal context, and AI-assisted explanations.

ORACLE is not an auto trading bot. The MVP is crypto-only, uses manual trade execution, and treats AI as an explanation layer rather than a prediction engine.

## Tech Stack

- Frontend: Next.js 14, TypeScript, Tailwind CSS, shadcn/ui-style components
- Backend: Python 3.11, FastAPI, SQLAlchemy, Alembic, Pydantic
- Database: PostgreSQL
- Market Data: CCXT, Binance API
- Analytics: pandas, numpy, pandas-ta
- AI: OpenAI API integration placeholder
- Local Development: Docker Compose

## MVP Features

- Premium dark dashboard shell
- Crypto scanner placeholder
- AI chat placeholder for analysis explanations
- Trading journal placeholder
- Settings placeholder
- Backend health endpoint
- Typed backend configuration
- SQLAlchemy database session setup
- Modular backend domains for services, indicators, regimes, signals, and AI
- Dockerized local frontend, backend, and PostgreSQL services

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

## Local Development

```bash
cp .env.example .env
docker compose --env-file .env up --build
```

Services:

- Frontend: http://oracleaicrypto.com
- Backend: http://oracleaicrypto.com
- Backend health: [http://render/health](https://oracle-ai-dashboard.onrender.com)

## Notes

- Trading logic should start deterministic and rule-based.
- AI output should explain evidence and context, not predict future prices.
- Trade execution remains manual for the MVP.
