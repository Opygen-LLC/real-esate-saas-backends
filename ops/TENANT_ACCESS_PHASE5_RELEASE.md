# Tenant Access Phase 5 — Production Release Runbook

This release finalizes the tenant access engine introduced in Phases 1–4. Subscription expiry is an access lock. It is not a retention or deletion event.

## Non-negotiable invariants

- Never delete tenant business data because a trial or paid period expires.
- Never change a plan ID/version in the Phase 5 structural migration.
- Never copy platform suspension into `subscription.status` or `websiteStatus`.
- Never publish a `provisioned` website during renewal recovery.
- Never remove a custom domain/TLS registration because subscription access is inactive.
- A successful renewal never overrides `platformAccess.status = suspended|archived|pending_deletion`.

## Pre-deploy

1. Put subscription/organization administrative writes into a short maintenance window for the migration.
2. Take the normal production database backup and verify the backup job completed.
3. Deploy the Phase 5 backend code before the Phase 5 frontend.
4. Run the structural migration in dry-run mode:

```bash
pnpm migrate:tenant-access-phase5
```

Review every blocker. The migration intentionally refuses to guess an unknown subscription status, missing plan ID, or invalid plan version.

5. Run the release verification:

```bash
pnpm verify:tenant-access-phase5
pnpm test:tenant-access-phase5
```

The integration test is enabled when `TEST_DATABASE_URL` is configured.

## Apply migration

After the dry-run is clean:

```bash
pnpm migrate:tenant-access-phase5 -- --apply
```

The migration backs up only organizations requiring structural backfill, fingerprints the complete `subscription` subdocument before and after, and aborts if the fingerprint changes. Eligible backfills are limited to `platformAccess.status` and `websiteStatus`; missing website state is fail-closed to `provisioned`.

## Post-deploy smoke matrix

Verify with non-production test tenants before broad traffic:

- Active trial: dashboard 200; published public site available.
- Exact trial boundary: normal workspace API 402; public site/API 503/noindex; Billing/Profile/Support still usable.
- Paid period end without renewal: same lock behavior.
- Direct public property, agent, lead form and viewing form requests cannot bypass the lock.
- Subdomain and custom-domain resolver still resolve the tenant but report `publicAccess.allowed=false` while locked.
- Renewal: dashboard and published public site recover without DNS/TLS reprovisioning.
- Suspended tenant + renewal: subscription may be active, but workspace/site stay locked until Super Admin reactivation.
- `websiteStatus=provisioned` + renewal: dashboard restores, website remains unpublished.
- Compare tenant record counts/IDs before and after expiry; no tenant business data should disappear.

## Monitoring

Scrape and alert on these metrics:

- `tenant_access_locked_total{reason}` — lock evaluations by bounded reason.
- `tenant_access_lock_reason{reason}` — current locked-tenant gauge by reason.
- `subscription_expiry_transition_total{previous,next,plan}` — durable lifecycle boundary transitions.
- `subscription_reactivation_total{source,previous,next}` — inactive-to-active subscription recoveries.
- `public_site_access_denied_total{reason}` — public access denials.
- `subscription_lifecycle_last_success_timestamp` — last successful lifecycle-worker run (Unix seconds).
- `subscription_lifecycle_failures_total` — lifecycle reconciliation failures.
- `tenant_access_metrics_failures_total` — aggregate access-gauge refresh failures.
- Phase 4 cache/realtime/background-sync failure counters and deferred-work gauges.

Recommended production alerts:

- lifecycle last-success older than four worker poll intervals;
- any sustained increase in `subscription_lifecycle_failures_total`;
- any sustained increase in tenant-access cache/revalidation/realtime sync failure counters;
- unexpected jump in `tenant_access_lock_reason{reason="SUBSCRIPTION_EXPIRED"}` after a release;
- public access denial spike not explained by expected expiry volume.

Metric labels deliberately exclude organization IDs to prevent unbounded Prometheus cardinality. Use structured application logs and Super Admin Agency 360 for tenant-specific investigation.

## Rollback

The access engine is derived from existing platform/subscription/website facts, so code rollback does not require mass tenant mutation. If the structural migration must be reversed, use the generated migration backup/manifest for only the structurally modified organization documents. Do not restore tenant business collections because Phase 5 does not delete or rewrite them.
