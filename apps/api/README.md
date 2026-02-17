# API Service (`apps/api`)

Railway-targeted API service for baseline and scenario simulation endpoints.

## Endpoints

- `GET /health`
- `POST /v1/auth/guest`
- `POST /v1/auth/recover`
- `POST /v1/auth/recovery-key/rotate`
- `GET /v1/auth/me`
- `GET /v1/disclaimer`
- `POST /v1/baseline`
- `POST /v1/scenarios/run`
- `POST /v1/scenarios/compare`
- `GET /v1/sessions?limit=10`
- `GET /v1/sessions/:sessionId`

Auth notes:

- The API uses a lightweight guest bearer token flow.
- Call `POST /v1/auth/guest` once and store:
  - `token`
  - `user.publicIdentityId`
  - `recoveryKey` (shown once)
- Send `Authorization: Bearer <token>` for baseline/scenario/session endpoints.
- Sessions are scoped to token `userId`; cross-user session access is blocked.
- If token is lost/expired, call `POST /v1/auth/recover` with `publicIdentityId + recoveryKey`.
- Use `POST /v1/auth/recovery-key/rotate` to replace the recovery key.

## Environment

Copy `apps/api/.env.example` to `.env` and set:

- `PORT`
- `CORS_ORIGIN`
- `DATABASE_URL` (optional, for PostgreSQL persistence)
- `DATABASE_SSL` (`true` only if your DB requires SSL)
- `AUTH_SECRET` (required outside local development)
- `AUTH_TOKEN_TTL_SECONDS` (token expiry in seconds)
- `RECOVERY_THROTTLE_WINDOW_MS` (optional, default `600000`)
- `RECOVERY_THROTTLE_MAX_ATTEMPTS` (optional, default `8`)
