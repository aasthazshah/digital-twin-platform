# Implementation Plan (Website First on Vercel + Railway)

- [ ] 1. Initialize project structure for web-first delivery
  - Create folders for `apps/web`, `apps/api`, `packages/shared`, and `tests`
  - Add shared contracts for `LifestyleInput`, `BaselineState`, `ScenarioInput`, `ScenarioResult`, and `ComparisonViewModel`
  - Add `.env.example` files for Vercel and Railway variables
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 2. Deploy first website version to Vercel
  - Scaffold frontend app and connect repository to Vercel project
  - Build core screens with mock/local simulation data
  - Configure preview and production environments on Vercel
  - _Requirements: 4.2_

- [ ] 3. Build website input and simulation UX
  - Create input form with clear labels and constrained options
  - Build scenario editor for multiple what-if scenarios
  - Build baseline-vs-scenario comparison view with simple visual cues
  - Ensure disclaimer is visible in UI
  - _Requirements: 3.1, 3.3, 3.4, 4.1, 4.2_

- [ ] 4. Implement core scoring library (rule-based, non-clinical)
  - Implement factor mappings and weighted scoring
  - Normalize weights when optional fields are missing
  - Add trend direction and deviation calculations
  - Add deterministic unit tests for scoring logic
  - _Requirements: 3.2, 3.3, 3.4, 5_

- [ ] 5. Implement input validation and error model
  - Validate required fields and enum values
  - Enforce `sleepHours` range `0..24`
  - Return structured validation errors for UI/API consistency
  - _Requirements: 3.1, 4.2_

- [ ] 6. Create Railway backend API service
  - Scaffold API service and deploy to Railway
  - Implement `POST /v1/baseline`, `POST /v1/scenarios/run`, `POST /v1/scenarios/compare`, `GET /v1/disclaimer`
  - Add `/health` endpoint and Railway healthcheck configuration
  - Ensure service binds to Railway `PORT`
  - _Requirements: 3.2, 3.3, 3.4, 4.3_

- [ ] 7. Connect Vercel website to Railway API
  - Configure `NEXT_PUBLIC_API_URL` in Vercel environments
  - Set CORS allowlist for Vercel preview and production domains
  - Switch UI from mock data to live API with graceful fallback handling
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 8. Add Railway PostgreSQL persistence
  - Provision Railway PostgreSQL and wire `DATABASE_URL`
  - Persist baseline/scenario sessions and retrieval metadata
  - Add migrations for minimal schema and rollback strategy
  - _Requirements: 3.2, 3.3, 4.1, 5_

- [ ] 9. Implement safety and ethics guardrails
  - Add mandatory educational disclaimer to all API responses
  - Block or rewrite diagnosis/treatment/prescription language
  - Add automated tests using prohibited phrase fixtures
  - _Requirements: 4.1_

- [ ] 10. Add integration and end-to-end testing
  - Test flow: input -> baseline -> scenarios -> comparison
  - Test optional fields, batch scenarios, and error paths
  - Test website-to-API connectivity across preview and production
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.2_

- [ ] 11. Validate performance and reliability
  - Benchmark scenario batch runtime and confirm `<= 2 seconds`
  - Tune API compute path and caching for repeated scenario calls
  - Add basic monitoring/logging for Vercel and Railway services
  - _Requirements: 4.3_

- [ ] 12. Final hardening and go-live
  - Configure custom domains: `app.<domain>` and `api.<domain>`
  - Validate env separation for `development`, `preview/staging`, and `production`
  - Complete privacy check: no real patient medical record storage
  - Run final smoke tests and publish release notes
  - _Requirements: 4.1, 5_
