# Digital Twin Platform

Website-first monorepo for the Personalized Digital Twin Health App.

## Structure

- `apps/web` - Vercel-hosted frontend (Next.js)
- `apps/api` - Railway-hosted API service (Node/Express)
- `packages/shared` - shared interfaces and types
- `.kiro/specs/digital-twin-platform` - requirements, design, tasks, and diagrams

## Deployment Plan

- Frontend: Vercel
- Backend API: Railway
- Database: Railway PostgreSQL (next phase)

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Run web:
```bash
npm run dev:web
```

3. Run API:
```bash
npm run dev:api
```

