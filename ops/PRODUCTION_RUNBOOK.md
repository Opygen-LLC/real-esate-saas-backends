# Production deployment and reliability runbook

## Production URLs for this deployment

- Frontend: `https://opygenesate.vercel.app`
- API origin: `https://api.faysaldev.com`
- `PUBLIC_API_URL` must be the origin only: `https://api.faysaldev.com` (never append `/api/v1`).
- Vercel browser traffic should use the same-origin `/backend-api/*` rewrite. Set `API_PROXY_TARGET=https://api.faysaldev.com`, `NEXT_PUBLIC_API_URL=https://api.faysaldev.com/api/v1`, and `NEXT_PUBLIC_USE_API_PROXY=true` on the frontend deployment.

## Required topology

- MongoDB must be a replica set or mongos. Transactions are required for tenant provisioning, plan versioning, website publishing, and billing. A standalone MongoDB instance is rejected by production startup.
- Redis must use a password. Managed/public Redis must also use TLS. The supplied Docker Compose deployment keeps Redis unexposed on an isolated bridge network and therefore uses `REDIS_ALLOW_INSECURE_PRIVATE_NETWORK=true` with TLS disabled only inside that private network.
- SMTP is a required dependency because account verification is email-first. Production startup verifies SMTP credentials/connectivity before the API becomes ready.
- Configure object storage, ClamAV, the Vercel custom-domain provider, and any enabled SMS provider using real production credentials. Never place secrets in the repository.

## First deployment

1. Copy `.env.example` to `.env` on the backend host and replace every `CHANGE_ME_*` value.
2. For Gmail SMTP use a Google App Password, not the normal account password. For another provider use its documented SMTP host/port/security settings.
3. Start the core stack:

   ```bash
   docker compose -f docker-compose.production.yml up -d --build
   ```

4. Confirm the single-node Mongo replica set elected a primary:

   ```bash
   docker compose -f docker-compose.production.yml exec mongo mongosh --quiet --eval 'db.hello().isWritablePrimary'
   ```

   It must print `true`.

5. Confirm Redis is authenticated and reachable from the API container:

   ```bash
   docker compose -f docker-compose.production.yml exec redis sh -lc 'redis-cli -a "$REDIS_PASSWORD" ping'
   ```

   It must print `PONG`.

6. Check readiness locally on the backend host:

   ```bash
   curl -fsS http://127.0.0.1:5000/health
   curl -fsS http://127.0.0.1:5000/ready
   ```

   `/ready` must report `mongo: true`, `mongoTransactions: true`, Redis ready, email configured/healthy, and a healthy worker (when enabled).

7. Only after local readiness is green should Cloudflare/Nginx/Tunnel route `api.faysaldev.com` to the API origin.

## Launch configuration that is intentionally not auto-approved

Some production features require real business/provider values and must not be bypassed in code:

- In Super Admin → Platform Settings, publish a legally reviewed privacy-policy URL/version and mark the legal review approved. Until then public enquiries and public viewing requests intentionally return 503 instead of collecting consent against an unapproved policy.
- Keep legacy gateway integrations disabled. Subscription changes use the manual payment ledger and super-admin confirmation workflow.
- Set `DOMAIN_PROVIDER=vercel`, `PUBLIC_SITE_ORIGIN`, `VERCEL_PROJECT_ID_OR_NAME`, and a real `VERCEL_API_TOKEN`. Set `VERCEL_TEAM_ID` and `VERCEL_REQUIRE_TEAM_ID=true` when the project/token is team-scoped. Startup fails closed in production when these required values are missing or the token is an obvious placeholder.
- Keep `WORKER_ENABLED=true` in production. Domain DNS/TLS retries, candidate promotion, and retired-domain cleanup depend on the durable operations worker. The production config refuses to boot with the worker disabled.
- Do not publish generic `76.76.21.21` / `cname.vercel-dns.com` values as the tenant instructions. The Vercel provider calls `GET /v6/domains/{domain}/config?projectIdOrName=...&strict=true` for the apex and `www` host, persists the rank-1 recommended A/CNAME records, and displays those exact values in the dashboard. `DOMAIN_A_TARGET` / `DOMAIN_CNAME_TARGET` are development/emergency hints only.
- `DOMAIN_REPLACEMENT_GRACE_HOURS` defaults to 168 hours. A live domain stays canonical while a replacement candidate verifies; after promotion the previous host remains registered as a permanent `308` redirect until the grace window expires, then the worker removes it from Vercel.
- Set the object-storage endpoint/credentials/public origin and ClamAV host before enabling those customer-facing workflows.

## Diagnosing 502/503

Use `/health` to determine whether the Node process is alive and `/ready` to determine whether dependencies are usable. A healthy process with `/ready` returning `503` means the problem is a dependency, not the Vercel rewrite.

```bash
curl -i https://api.faysaldev.com/health
curl -i https://api.faysaldev.com/ready
# Authenticated tenant check: GET /api/v1/domain/health shows worker, domain queue and Vercel reachability.
docker compose -f docker-compose.production.yml logs --tail=300 api
```

Common startup log messages now identify the failed dependency directly:

- `Missing or insecure production configuration: DOMAIN_PROVIDER` / `PUBLIC_SITE_ORIGIN` / `VERCEL_*` → custom-domain control plane is not configured for the actual Vercel project.
- `WORKER_ENABLED must be true in production...` → lifecycle retries/cutover cleanup would be disabled; enable the operations worker before booting the API.
- `VERCEL_API_TOKEN must be a real production access token...` → replace the placeholder with a scoped Vercel token that can read the project and manage its domains.
- `Production requires a MongoDB replica set or mongos...` → wrong Mongo topology/URL.
- `Redis is enabled but unavailable during startup` → host/password/network mismatch.
- `SMTP verification failed during startup...` → SMTP host, port, TLS mode, credentials, sender, firewall, or provider policy is wrong.

A registration response with code `EMAIL_DELIVERY_UNAVAILABLE` specifically means the account verification email could not be delivered after retrying; the partially provisioned tenant is cleaned up.

## Release procedure

1. Build immutable backend/frontend images from committed lockfiles.
2. Run the latest required migration once before routing production traffic to the new release. For this phase run `pnpm migrate:domain-cutover --apply --confirm=PHASE3-DOMAIN-CUTOVER` after taking the normal database backup.
3. Verify `/health`, `/ready`, and authenticated `/metrics` on every API replica.
4. Warm plan/public-site caches and verify Redis hit counters.
5. Exercise signup + OTP, login, dashboard, property publishing, public lead capture, manual subscription payment confirmation, enabled SMS, Meta CAPI, object upload/scan, and domain verification.
6. Watch p95 latency, 5xx rate, Mongo pool saturation, queue age/dead jobs, Redis errors, SMTP/provider failures, and circuit state during rollout.

## Backup/restore drill

Quarterly, restore the latest production backup into an isolated environment. Verify tenant counts, billing totals, recent domain events, website revisions, queue state, and at least one tenant end-to-end. Record restore point, restore duration, verification evidence, and owner sign-off. Never run a restore drill against the production database.

## Incident baseline

- 5xx >0.5% for 10 minutes: stop rollout and inspect request IDs plus `/ready` dependency state.
- Normal tenant-read p95 >300 ms: inspect Mongo slow queries/index usage, pool wait time, and Redis availability.
- Cached public-read p95 >100 ms: inspect Redis hit/error rate and hostname resolver cache.
- Queue oldest pending age >10 minutes: inspect worker readiness, failed/dead counts and external-provider circuits.
- Provider outage: leave durable jobs for retry. Do not bypass account verification or mark deliveries successful manually.
