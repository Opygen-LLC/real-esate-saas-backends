# Finance Phase 3 production rollout

Run this from a release candidate built from the same commit that will be deployed. Do not skip the read-only gates or run migrations before the database backup is confirmed.

1. **Backup database**
   - Build the backend, then run `pnpm backup:database` using production backup credentials.
   - Confirm the backup object exists and the backup job reports success.
2. **Read-only Finance audit**
   - `pnpm audit:finance -- --fail-on-findings`
   - Stop on critical findings. Investigate stale `ACTIVATING`, invalid account references, duplicate sources, unbalanced journals, or currency mismatches.
3. **Read-only Finance reconciliation**
   - `pnpm reconcile:finance-phase2 -- --fail-on-findings`
   - Stop on AR/AP/commission control-account differences, missing source postings, non-BDT data, or reconciliation differences.
4. **Repair only approved findings**
   - Use the Phase 2 repair tooling in dry-run mode first. Do not mutate financial history from migration scripts.
5. **Run only required idempotent migrations**
   - Use the existing migration verification output to determine which migration is required. Never run every migration blindly.
6. **Migration verification**
   - Run the matching `verify:advanced-accounting-phase*` command for every migration applied.
7. **SMTP verification**
   - `pnpm test:smtp`
   - Production must have `EMAIL_DEV_MODE=false` and a successful real provider connection.
8. **Backend contract + accounting integrity**
   - `pnpm gate:finance-phase3`
   - Against an isolated replica-set test database: `pnpm test:finance-phase3:integration`
9. **Frontend typecheck/build + browser matrix**
   - In the frontend repository: `pnpm gate:finance-phase3`
   - On staging with the required test accounts and Gmail mailbox: `pnpm test:e2e:finance-phase3:required`
10. **Deploy backend first**
    - Confirm health/readiness, `/auth/session` accounting migration state, and Finance API responses before deploying the frontend.
11. **Deploy frontend**
    - Confirm all nine Finance navigation surfaces load for the correct roles and accounting states.
12. **Production smoke + financial invariants**
    - `pnpm verify:finance-phase3-production -- --fail-on-findings`
    - Confirm Trial Balance is balanced and Assets = Liabilities + Equity for every initialized organization.
13. **Monitor Finance failures**
    - Query structured event `finance_request_failed` grouped by `statusCode`, `errorCode`, `route`, and `organizationId`.
    - Alert on unexpected growth in `403`, `409`, `422`, and `500`; investigate `500` immediately.
    - Correlate individual support reports using `requestId` from the frontend Finance error state.

Rollback rule: if production verification reports an accounting invariant failure or Finance 5xx rate materially increases after deployment, stop writes/deployment progression and roll back the application release. Never “repair” an unbalanced ledger by deleting or editing posted journal lines.
