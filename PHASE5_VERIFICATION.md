# Phase 5 verification status

The Phase 5 backend patch adds immutable renderer generation binding, legacy-safe migration/backup tooling, explicit rollout controls, pilot-cohort support, rollback history, release telemetry, database-backed rollout tests, and staging query-plan/profiling gates.

## Verified in this build environment

- 174/174 dependency-free backend Phase 1–5 regression tests pass.
- Backend formatting guard passes.
- Phase 5 backend rollout invariant verifier passes.
- 9 canonical website/catalog contracts are synchronized with the frontend.
- 17 changed backend TypeScript files pass TypeScript syntactic transpilation with zero errors.
- `package.json` and generated JSON parse successfully.

## Required CI/staging release gates

Run `pnpm gate:phase5-website-rollout` after a frozen-lockfile install. It performs linting, application/test typechecks, production build, unit/contract/security regressions, Phase 1/2/3/5 checks, and a current high-severity dependency audit.

Run `pnpm gate:phase5-website-rollout:staging` with an isolated replica-set test database plus explicit staging catalog profiling inputs. It runs the full integration suite, renderer opt-in/rollback/conflict integration tests, representative property query execution-stat profiling, and query-plan verification.

The current execution environment has no repository `node_modules`, and Corepack cannot reach `registry.npmjs.org`, so dependency-installed build/lint/full-typecheck/audit/database/browser execution could not be run here. Do not deploy until both supplied gates pass against the target release environment.
