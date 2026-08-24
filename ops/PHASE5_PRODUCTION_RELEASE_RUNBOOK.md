# Phase 5 — Regression, reconciliation, staging, and production release

This phase is the production gate for the Viewing, CRM, tenant branding/revalidation, quota-transaction, authentication, subscription, and polling fixes delivered in Phases 1–4.

## 1. Freeze and back up production

Do not run reconciliation while a deployment or subscription-admin change is in progress.

1. Record the backend commit/image SHA and frontend deployment SHA.
2. Take a provider-level MongoDB snapshot or a verified `mongodump` before any `--apply` command.
3. Record the backup identifier and restore point in the release ticket.
4. Confirm the API currently reports `mongoTransactions: true` from `/ready`.

A code rollback is preferred over a database restore. Restore data only for confirmed corruption.

## 2. Audit old false-failure requests before changing data

The old Viewing bug could commit the Viewing update and then fail while writing its DomainEvent. The old team-quota bug could commit a trial/admin transaction and then return a false 500 when the callback intentionally returned `void`.

Run the Phase 5 reconciliation in dry-run mode first:

```bash
pnpm reconcile:phase5-false-failures -- --since=2026-08-01T00:00:00.000Z
```

If the production logs contain known false-500 request IDs, scope the audit to those IDs:

```bash
PHASE5_AFFECTED_REQUEST_IDS="request-id-1,request-id-2" \
  pnpm reconcile:phase5-false-failures -- --since=2026-08-01T00:00:00.000Z
```

The command writes a manifest under `migration-backups/`. Review:

- `missingEvents`
- `missingActivities`
- `relationshipRisks`
- `committedTrialActions`
- `quotaRisks`

An existing `subscription.trial_updated` audit row means the old admin action may already have committed. **Do not replay the original request.**

The reconciliation intentionally does **not** change an existing Viewing, Lead, subscription, quota, or trial state. It only inserts a missing Viewing DomainEvent/Activity projection and does not publish realtime/cache/provider side effects.

Apply additive Viewing history repairs only after review:

```bash
pnpm reconcile:phase5-false-failures -- \
  --since=2026-08-01T00:00:00.000Z \
  --apply \
  --confirm=PHASE5-FALSE-FAILURE-REPAIR
```

If the command reports `relationshipRisks` or `quotaRisks`, it exits with code `2`. Resolve those records manually; the script will not guess or rewrite business state.

## 3. Release-candidate verification

Use a disposable MongoDB replica set or mongos for `TEST_DATABASE_URL`. A standalone MongoDB is not an acceptable release-test topology.

```bash
corepack pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm typecheck:test
pnpm build
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm test:phase5-production
pnpm verify:phase5-production
pnpm verify:release
```

Phase 5 regression coverage includes:

- Viewing reschedule and status update
- `Completed` Viewing → `ViewingCompleted` Lead lifecycle
- canonical ObjectId `DomainEvent.leadId`
- Viewing Activity projection
- atomic Lead status/assignee/follow-up management
- CRM pagination without `$lookup` inside `$facet`
- Website Submission → existing linked Lead without duplicate creation
- successful `void` quota transactions
- concurrent final-seat reservation serialization
- bearer authentication with expired-subscription 402 behavior
- tenant favicon/revalidation and frontend polling release contracts

## 4. Staging deployment

Staging must use the same MongoDB topology class, Redis behavior, `NEXT_REVALIDATE_SECRET` length/value contract, and reverse-proxy layout as production.

Deploy the **backend first**. Wait for both endpoints to be green:

```bash
curl -fsS "$STAGING_API_URL/health"
curl -fsS "$STAGING_API_URL/ready"
```

Then deploy the frontend using the same `NEXT_REVALIDATE_SECRET` as the backend.

Run the staging smoke gate with a dedicated active staging tenant and staging-only authentication token:

```bash
STAGING_API_URL="https://staging-api.example.com" \
STAGING_FRONTEND_URL="https://staging.example.com" \
STAGING_AUTH_TOKEN="..." \
METRICS_TOKEN="..." \
STAGING_TENANT_IDENTIFIER="staging-agency" \
STAGING_ORGANIZATION_ID="org_staging_release" \
NEXT_REVALIDATE_SECRET="...same-secret-on-both-services..." \
pnpm smoke:phase5-staging
```

The smoke gate checks health/readiness, authenticated session, CRM Leads, Website Submissions, Viewings, tenant portal/favicon, branding revalidation HTTP 200, and verifies that the exercise created **zero new** release-blocker metrics.

Do not promote if staging increments any of:

- `crm_read_model_fallback_total`
- `viewing_update_internal_failures_total`
- `domain_event_failures_total`
- `next_revalidation_failures_total`
- `team_quota_transaction_failures_total`
- disallowed new HTTP 5xx

## 5. Production deployment order

1. Confirm the backup is complete and the Phase 5 dry-run manifest has been reviewed.
2. Confirm all CI/release checks passed for the exact immutable commit.
3. Deploy backend first.
4. Verify `/health`, `/ready`, and authenticated `/metrics` on the new backend.
5. Confirm no migration/reconciliation command is still running.
6. Deploy frontend second.
7. Verify the main platform favicon and one tenant favicon.
8. Change a staging/pilot tenant favicon and verify `organization.branding_updated` revalidation returns 200 and the refreshed tenant site shows the new favicon.
9. Update one pilot Viewing, mark it Completed, and verify the linked Lead is `ViewingCompleted` with a valid Viewing DomainEvent/Activity.
10. Edit one pilot Lead status, assignee, and follow-up from the Edit Lead workflow.
11. Open one Website Submission and use **Manage in CRM** to open its existing linked Lead.

## 6. Post-deploy watch

Start the release watch immediately after the backend/frontend production deployment:

```bash
PRODUCTION_METRICS_URL="https://api.example.com/metrics" \
METRICS_TOKEN="..." \
PHASE5_MONITOR_MINUTES=15 \
PHASE5_MONITOR_INTERVAL_SECONDS=30 \
PHASE5_MAX_NEW_5XX=0 \
pnpm monitor:phase5-production
```

The watch snapshots cumulative metrics at startup and fails on any new CRM fallback, Viewing internal failure, DomainEvent failure, revalidation failure, quota transaction invariant failure, or disallowed 5xx during the observation window.

Also inspect structured Cloud Logging by `requestId`, `event`, `route`, and `errorCode`. Expected 401/402 operational responses must not appear as application `ERROR` events.

## 7. Rollback criteria

Stop rollout and roll application traffic back to the previous immutable version if any of these repeat after deployment:

- Mongo error `40600` / `$lookup is not allowed to be used within a $facet stage`
- Viewing update returns a false 400 after the database state changed
- `next_revalidation_failed` with 401
- `Team quota transaction did not complete`
- `domain_event_failures_total` increases
- unexpected 5xx increases during the release watch

Do not reverse additive reconciliation records during a normal code rollback. Do not replay failed-looking historical admin requests without checking their immutable audit rows first.
