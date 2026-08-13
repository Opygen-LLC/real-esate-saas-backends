# Production deployment and reliability runbook

## Required topology

- Run MongoDB as a managed replica set/mongos with point-in-time backup enabled. Production startup intentionally fails if transactions are unavailable.
- Run Redis with authentication and TLS. Use a deployment-specific `REDIS_KEY_PREFIX` and separate `REDIS_CACHE_NAMESPACE`/`REDIS_QUEUE_NAMESPACE` values.
- Use private object storage credentials, a CDN/public media origin, and reachable ClamAV scanning infrastructure.
- Run at least two API replicas behind an HTTPS load balancer. Workers use persisted Mongo leases, so replicas can run the worker safely; disable `WORKER_ENABLED` on web replicas if a dedicated worker deployment is preferred.

## Release procedure

1. Build immutable backend/frontend images from the committed lockfiles.
2. Run `pnpm migrate:phase-6` once before routing production traffic to the new release.
3. Verify `/health`, `/ready`, and authenticated `/metrics` on every API replica.
4. Warm the plan/public-site cache with smoke requests and verify Redis hit counters.
5. Exercise login, dashboard, public property search, lead capture, publish, bKash callback, SMS queue, Meta CAPI, and domain verification smoke tests.
6. Watch p95 latency, HTTP 5xx rate, Mongo pool saturation, queue oldest age/dead jobs, Redis errors, and provider circuit state during rollout.

## Backup/restore drill

Quarterly, restore the latest production backup into an isolated environment. Verify tenant counts, billing totals, recent domain events, website revisions, queue state, and at least one tenant end-to-end. Record restore point, restore duration, verification evidence, and owner sign-off. Never run a restore drill against the production database.

## Incident baseline

- 5xx >0.5% for 10 minutes: stop rollout, inspect request/trace IDs and provider circuit metrics.
- Normal tenant-read p95 >300 ms: inspect Mongo slow queries/index usage, pool wait time, and Redis availability.
- Cached public-read p95 >100 ms: inspect Redis hit/error rate and hostname resolver cache.
- Queue oldest pending age >10 minutes: inspect worker readiness, failed/dead counts and external-provider circuits.
- Redis outage: public reads fall back to Mongo; do not flush Mongo or disable tenant checks. Restore Redis and allow caches to repopulate.
- Provider outage: leave jobs durable for retry. Do not bypass verification or mark deliveries successful manually.
