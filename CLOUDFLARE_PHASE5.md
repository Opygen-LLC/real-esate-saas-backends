# Cloudflare Phase 5 — production release and Vercel retirement

This phase is intentionally split into **verification**, **stability**, and **retirement**. Do not remove Vercel project domains or secrets during the initial Cloudflare cutover.

## Production architecture

- Frontend/runtime: Cloudflare Workers + vinext.
- Free tenant sites: proxied `*.realestate.opygen.com` wildcard routed to the frontend Worker.
- Customer domains: Cloudflare for SaaS Custom Hostnames.
- Backend/API: unchanged.
- MongoDB, Redis and R2: unchanged.
- Tenant ownership/routing authority: backend domain service, not Cloudflare configuration.

## 1. CI gate

Run the frontend Phase 5 gate before deploying staging. It executes vinext compatibility, typecheck, lint, the existing frontend security/component suite, all Cloudflare Phase 1–5 contract suites and a vinext production build.

```bash
pnpm gate:cloudflare-phase5
```

Run the backend repository's normal release gate plus:

```bash
pnpm test:phase2-cloudflare-domain
pnpm test:phase3-cloudflare-platform
pnpm test:phase4-cloudflare-migration
pnpm test:phase5-cloudflare-release
pnpm cloudflare:phase5:preflight
```

## 2. Staging live gate

Set three real HTTPS fixtures:

```text
CLOUDFLARE_PHASE5_STAGING_ROOT_URL=
CLOUDFLARE_PHASE5_STAGING_TENANT_URL=
CLOUDFLARE_PHASE5_STAGING_CUSTOM_URL=
```

Optional fixtures add redirect/lock-state verification:

```text
CLOUDFLARE_PHASE5_STAGING_OLD_SUBDOMAIN_URL=
CLOUDFLARE_PHASE5_STAGING_SUSPENDED_URL=
CLOUDFLARE_PHASE5_STAGING_UNPUBLISHED_URL=
```

Then run:

```bash
pnpm cloudflare:phase5:verify-staging
```

The gate verifies the Opygen marker on root, free subdomain and unrelated custom domain; normal page rendering; cross-tenant `/portal/*` denial; Engine.IO polling plus WebSocket availability; old-subdomain 308 when configured; and suspended/unpublished fail-closed responses.

For a real browser WebSocket upgrade use the frontend Playwright gate:

```bash
pnpm test:e2e:phase5-cloudflare:required
```

## 3. DNS-provider matrix

`CLOUDFLARE_PHASE5_DNS_MATRIX_JSON` is read-only. It never creates, modifies or deletes customer DNS records. Use it for Cloudflare DNS, Namecheap, GoDaddy, Hostinger or another provider.

Example:

```json
[
  {"provider":"cloudflare","hostname":"www.customer-one.com","mode":"cname","emailDomain":"customer-one.com","requireSpf":true},
  {"provider":"namecheap","hostname":"www.customer-two.com","mode":"cname"},
  {"provider":"godaddy","hostname":"customer-three.com","mode":"apex","emailDomain":"customer-three.com"},
  {"provider":"hostinger","hostname":"www.customer-four.com","mode":"cname"}
]
```

Run:

```bash
pnpm cloudflare:phase5:verify-dns-matrix
```

For CNAME fixtures the target must resolve to `CLOUDFLARE_SAAS_CNAME_TARGET`. Apex fixtures must resolve publicly and return the Opygen domain marker. If `emailDomain` is supplied the gate verifies MX preservation and, when `requireSpf` is true, an SPF TXT record. The script does not instruct customers to remove MX, SPF, DKIM, DMARC or unrelated TXT records.

## 4. Production verification and stability window

Configure:

```text
CLOUDFLARE_PHASE5_PRODUCTION_ROOT_URL=https://realestate.opygen.com
CLOUDFLARE_PHASE5_PRODUCTION_TENANT_URL=
CLOUDFLARE_PHASE5_PRODUCTION_CUSTOM_URL=
CLOUDFLARE_PHASE5_STABILITY_HOURS=72
CLOUDFLARE_PHASE5_MAX_VERIFY_AGE_MINUTES=60
```

Run after production cutover and periodically during the stability period:

```bash
pnpm cloudflare:phase5:verify-production
```

A successful check creates/updates `.cloudflare/phase5-release-state.json` with the first and latest verified timestamps. Keep that file private; it is an operator state file and is not application configuration.

## 5. Observability to watch

The existing `/metrics` pipeline now includes:

- `domain_activation_duration_ms`
- `cloudflare_domain_api_failures_total`
- `cloudflare_domain_certificate_failures_total`
- `cloudflare_domain_hostname_validation_failures_total`
- `domain_resolver_requests_total`
- `tenant_routing_mismatch_total`
- `realtime_connections_total`
- `realtime_disconnects_total`
- existing `http_request_duration_ms` for backend/API latency

The Worker emits structured events for Socket.IO configuration/upstream/upgrade failures and unhandled Worker request exceptions. Client realtime reconnect/connection errors flow through the existing operational-event endpoint.

Alert at minimum on sustained Cloudflare API/certificate failures, rising resolver `not_found`/`error` outcomes, tenant-routing mismatches, Worker exceptions, API latency degradation and abnormal realtime reconnect/disconnect rates.

## 6. Database retirement gate

Before removing Vercel, run:

```bash
pnpm cloudflare:phase5:domains:retirement-plan
```

The gate blocks retirement while any domain still:

- serves from Vercel or lacks a finalized provider,
- is in `CF_REGISTERED`, `WAITING_DNS`, `CF_TLS_ACTIVE` or `TRAFFIC_SWITCHED`,
- has an active rollback window,
- has a Vercel replacement candidate, or
- has a retired Vercel hostname whose provider cleanup has not completed.

Do not bypass this gate with manual database edits.

## 7. Vercel project-domain retirement

First inspect what would be removed:

```bash
pnpm cloudflare:phase5:vercel-plan
```

The command inventories all project domains with pagination and selects only:

```text
realestate.opygen.com
www.realestate.opygen.com
*.realestate.opygen.com
```

It does not remove customer domains or unrelated Vercel project bindings.

After the database retirement gate is clean, the Cloudflare production gate has remained healthy for the configured stability window, and a fresh production verification is less than `CLOUDFLARE_PHASE5_MAX_VERIFY_AGE_MINUTES` old, explicitly enable removal:

```text
CLOUDFLARE_PHASE5_ALLOW_VERCEL_PROJECT_DOMAIN_REMOVAL=true
```

Then run:

```bash
pnpm cloudflare:phase5:retire-vercel
```

After that command succeeds, re-run production verification. Then revoke/remove `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID_OR_NAME` and `VERCEL_TEAM_ID` from the production backend runtime. Keep `vercelDomainProvider.ts` in source until you intentionally remove historical rollback support in a later maintenance release.

Do not delete the Vercel project automatically. A project can contain unrelated deployments/domains. Delete it manually only after the Vercel plan and dashboard both show that nothing else is needed.
