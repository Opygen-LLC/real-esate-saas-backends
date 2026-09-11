# Phase 1 backend patch

## Release status: implementation supplied; production release blocked

This is a changed-files overlay for `real-esate-saas-backends-main.zip`, not a complete repository or a production-certification claim. Dependency installation was blocked by registry/DNS access in the implementation environment. No real MongoDB service or Docker runtime was available. Full dependency-backed TypeScript checks, application builds, database integration tests, live provider tests and browser screenshot capture have NOT passed here because they were NOT executed. Do not deploy this patch directly to production. Complete `docs/phase1/VALIDATION.md` first.

Actual results: **128 backend policy/adapter tests passed**, both repository format guards passed, and **1,358 JavaScript/TypeScript files parsed without syntax errors** across both projects. Adapter rollback tests execute the real service with database doubles: they do not prove MongoDB transaction behavior. The frontend still has one pre-existing Unsplash-policy test failure. No dependency version or dependency lock graph was changed.

## Applying only the changed files

Back up your current repository and database. This patch is based on the exact supplied archive; stop and merge manually if your working tree has changed. Extract this ZIP into a temporary directory first, then run:

```sh
node /tmp/phase1-backend/scripts/verify-phase1-patch.mjs --before --target /path/to/backend
# Only after the compatibility check succeeds:
cp -a /tmp/phase1-backend/. /path/to/backend/
cd /path/to/backend
node scripts/verify-phase1-patch.mjs
```

The ZIP contains no complete dependency installation, secrets, original unmodified source files or database contents. The SHA-256 manifest lists every added/modified file. It excludes its own hash to avoid recursive hashing. There are no backend file deletions.

## Reproducible dependency setup

Use Node **22.16.0 or a reviewed newer 22.x patch** and **pnpm 10.27.0**. Both projects reject installation through a different package manager/version. The existing `pnpm-lock.yaml` remains authoritative and unchanged.

```sh
corepack enable
corepack prepare pnpm@10.27.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env
```

Generate independent strong values for secrets with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep real values outside version control. Share only the intended `NEXT_REVALIDATE_SECRET` between the API and frontend. Do not use fixture credentials or development fallbacks in production.

Docker build scripts copy the package-manager guard before installation. This pins the dependency graph, not the entire operating-system image: the inherited `node:22-*`, Mongo and Redis tags are mutable. Approve and record immutable image digests in the deployment system before release. The API and backup Docker targets are otherwise retained.

### Environment contract

`DATABASE_URL` must select a MongoDB replica set or mongos. Sensitive finance and viewing writes return `503 TRANSACTIONS_REQUIRED` on a standalone server even in development; they never silently fall back to partial writes.

Set public URLs and allowed origins for your own deployment. The production configuration still requires the existing JWT, OTP, encryption and revalidation secrets, SMTP, approved domain-provider settings, Cloudflare R2 storage settings, antivirus configuration as applicable, and worker/realtime requirements. `.env.example` is for local use, not a complete production deployment profile. Phase 5 GCS migration credentials belong only in the one-off migration environment under `scripts/storage-migration/.env.migration.example`; they must not be injected into the normal API or worker containers. No storage credential is included in source control.

`TRUST_PROXY=false` is appropriate only when the API is reached directly. Behind a reverse proxy, set the actual trusted proxy IPs/CIDRs. Never use unrestricted `true`, hop counts, `0.0.0.0/0` or `::/0`. Ensure the edge strips untrusted forwarded headers and prevents direct public access to the API. Broad private CIDRs are not a substitute for determining the real proxy boundary.

`METRICS_TOKEN` must be a unique secret for production metrics access; an empty value does not enable anonymous production metrics. `/health` and `/ready` are intentionally minimal. `/internal/health` and `/internal/ready` require a platform-superadmin session. Existing monitors that used detailed public health fields must switch to an authorized internal check.

## Isolated local database and integration gate

The Compose file below is **test-only**: unauthenticated, loopback-bound and temporary. It must never be exposed remotely or used for production data. The integration runner intentionally drops its selected database. It refuses non-local hosts, SRV URLs, database names not beginning with `phase1_`, and URLs without `directConnection=true`.

```sh
docker compose -f compose.phase1-test.yml up -d --wait
export TEST_DATABASE_URL='mongodb://127.0.0.1:27018/phase1_integration?replicaSet=rs0&directConnection=true'
pnpm test:phase1-unit
pnpm gate:phase1-atomic
# Also run the complete existing test and security suites before release:
pnpm test
pnpm test:security
```

The dedicated integration suite covers API deletion authorization, fresh owner checks, actual transaction rollback after a forced reversal write, simultaneous request replay, unequal overlapping intervals, adjacent intervals, reactivation, atomic lead/quota/consent/inbox capture, tenant isolation, reminder replay/staleness, public health privacy and calendar deletion outbox rows. These integration assertions are provided but **not executed** in this environment. Existing integration suites were corrected where their expectations contradicted owner-only removal or the minimal public receipt contract. No regression assertion was removed merely to turn a failure green.

## Finance behavior

- `finance.delete` is required at destructive routes; `finance.write` is no longer accepted as an alternative. The service also checks the active user, current owner role, organization ownership and block state. A caller-supplied role cannot bypass that check.
- Ordinary edits, void/cancel and remove/archive are separate operations. Manual transactions must be voided before removal. Payments linked to an invoice or commission cannot be removed or voided through the generic transaction action.
- Only draft/cancelled unpaid invoices without payment history can be archived. Sent/overdue unpaid invoices must be explicitly voided first. Paid invoices and historical payments are retained.
- Commissions must be cancelled with no payout history before archival. Vendor/budget status changes also enforce owner-only destructive policy, including PATCH paths.
- Transaction, source-record and linked-journal changes run in required transactions, independent of optional automatic accounting. Reversal errors abort instead of being swallowed. Existing posted journals must be reversed before removal.
- Audit records for these operations share their transaction. Existing noncritical post-commit finance realtime notifications remain best-effort; this patch does not promise exactly-once delivery for every event in the application.
- The previous read-time invoice-payment hiding/voiding routine is removed. Reads no longer silently modify that history. No automatic historical ledger repair is performed.

## Viewing capture and durable work

An organization-document write occurs before availability reads. This makes conflicting writers retry with a fresh transaction snapshot across API replicas. It handles arbitrary time overlap, not only identical start times. Scheduled, Confirmed and Rescheduled states reserve availability. Adjacent half-open intervals are permitted. Updates validate the merged record; cancellation/reactivation/deletion use the same lock.

The lock is intentionally tenant-wide. This favors correctness over maximum throughput for one very large agency; different agencies do not share a lock. All deployment writers must use the new code. Do not run old and new viewing writers together.

A public request accepts a 16-128-character URL-safe `Idempotency-Key`. The frontend now supplies a stable key for retries of the same form. The server stores only scoped key/payload digests and a minimal receipt, with a 24-hour expiry. Same key and same payload returns the original receipt; the same key with different business data returns 409. Old clients without a header use a payload-derived compatibility key. Expired keys do not provide indefinite deduplication. A key is not authentication and does not authorize access to private CRM data.

Lead capture, allowance consumption, consent, viewing, inbox submission, receipt and job intentions commit together. Existing contact identity is not silently overwritten or merged. Failures leave no committed partial operation. A concurrent unrelated CRM writer may still produce a safe rolled-back duplicate-key error; this patch does not guarantee every arbitrary external CRM race is translated to 409.

The existing MongoDB operations queue is the durable outbox. Workers publish committed events and perform calendar/reminder work afterward. Unique claim tokens fence acknowledgements and retries. Reminder effects use a committed marker and a transaction, so a worker retry cannot create the same database notification/history twice. Stale, cancelled or already-started viewing reminders are skipped. Reschedules replace older jobs under the same scheduling lock. Deletion writes a versioned calendar tombstone before removing the viewing.

Production currently requires `WORKER_ENABLED=true` under the existing configuration policy. Monitor pending/failed jobs and worker health; never disable the worker to hide failures. Failed jobs are retained, not silently discarded. Recovery and manual retry procedures are in `docs/phase1/OPERATIONS.md`.

### Calendar gateway prerequisite

Set `CALENDAR_PROVIDER_APPROVAL_STATUS=approved`, `CALENDAR_SYNC_URL` and `CALENDAR_SYNC_TOKEN` only for an approved/tested gateway. Every request carries a tenant-scoped `Idempotency-Key`, `organizationId`, `externalId` and increasing `revision`. **The gateway must atomically deduplicate those keys and reject older revisions, including requests that finish after the caller times out.** The application cannot guarantee external exactly-once effects by itself. Stage a delayed old upsert followed by a newer update/delete and verify that the old request cannot resurrect an event. Do not enable calendar delivery without that test. A cancelled viewing is sent with its cancelled status; a deleted viewing uses action `delete` and its durable tombstone.

## Public form and media protections

Public viewing rate limits are stored in MongoDB, shared across replicas, and fail closed when the counter store is unavailable. The current policy is 20 submissions per network per 15-minute fixed window and 300 per agency per window. IPv6 privacy addresses are grouped by /64 and mapped IPv4 addresses normalized. Hashed counter keys expire automatically; raw IPs are not stored in the counter collection. Validate the NAT/proxy behavior against your actual traffic before release; limits also count replay attempts.

Remote image imports now validate every DNS answer and redirect, and pin the HTTPS connection to the validated public address while retaining original-host certificate checks. Local, special-use and transition addresses, credentials/custom ports, unsupported formats, oversized bodies and mismatched image signatures are rejected. Downloads have deadlines, no shared connection pool, no automatic redirects, and a 20 MB limit. The existing decoded-image checks, scoped upload intents and asset ownership checks remain in place. This is not a substitute for egress firewall restrictions or antivirus verification in staging.

See `docs/phase1/SECURITY_REVIEW.md` for the exact review scope and remaining runtime checks.

## Rollout and rollback

Use a maintenance window and a verified backup. **Stop all old API/worker writers before migration**; a rolling mixed-version writer deployment bypasses the new concurrency discipline. On a staging clone first:

```sh
# DATABASE_URL here is your deliberately selected staging database, not TEST_DATABASE_URL.
pnpm migrate:phase1-atomic --apply
pnpm audit:phase1-atomic --fail-on-findings
```

The migration creates required collections/indexes and initializes missing schedule versions only. It does not rewrite money, erase history or resolve existing overlaps. Review every audit finding and reconcile through approved business/accounting processes. After the release gates pass, deploy the new backend/workers, then the frontend; verify authorization, concurrency, receipts, health, media import and queues in the deployed environment.

Database changes are additive, but old workers do not understand the new job types. A rollback must stop writers/workers, retain the new receipts/outbox/history, and use a reviewed compatible rollback build or the verified backup. Never run the old worker over the new queue or blindly replay financial operations. Treat maintenance rollback as an operator procedure, not an automatic destructive script.
