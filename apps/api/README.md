# API Service (`apps/api`)

Railway-targeted API service for baseline and scenario simulation endpoints.

## Endpoints

- `GET /health`
- `GET /v1/disclaimer`
- `POST /v1/baseline`
- `POST /v1/scenarios/run`
- `POST /v1/scenarios/compare`
- `GET /v1/sessions?limit=10`
- `GET /v1/sessions/:sessionId`

## Environment

Copy `apps/api/.env.example` to `.env` and set:

- `PORT`
- `CORS_ORIGIN`
- `DATABASE_URL` (optional, for PostgreSQL persistence)
- `DATABASE_SSL` (`true` only if your DB requires SSL)
