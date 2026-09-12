# Cloudflare Phase 4 — Zero-downtime migration from Vercel

This phase migrates existing Vercel custom domains to Cloudflare for SaaS without making the global `DOMAIN_PROVIDER` switch mutate every existing domain. Existing records remain pinned to their persisted provider until an explicit provider migration reaches the traffic-switch gate.

## Domain migration state machine

```text
NOT_STARTED
    -> CF_REGISTERED
    -> WAITING_DNS
    -> CF_TLS_ACTIVE
    -> TRAFFIC_SWITCHED
    -> VERCEL_REMOVED
```

The migration stores a legacy Vercel lifecycle snapshot and a separate Cloudflare target lifecycle. `providerRequestId` remains supported for legacy records while Cloudflare hostname IDs/statuses continue to live in provider metadata.

### Guarantees

1. Registering Cloudflare does not change the serving Vercel provider.
2. Cloudflare hostname validation and TLS must become ready before customers are asked to move web-routing DNS.
3. An Opygen public marker by itself cannot prove the cutover, because Vercel can serve the same marker. The target must also report Cloudflare routing/DNS readiness.
4. Only after Cloudflare DNS routing and the public marker are both verified is the primary record switched to `provider=cloudflare` and `TRAFFIC_SWITCHED`.
5. The Vercel registration is retained until the configured rollback grace expires.
6. Vercel removal requires a separate explicit operator command and allow flag.
7. Rollback after traffic switch first verifies the legacy Vercel route, TLS, and public marker, then restores the snapshotted lifecycle without manual database surgery.
8. Retired-domain cleanup records the provider that owns each retired registration, so changing providers cannot accidentally delete a hostname from the wrong provider.

## Configuration

Keep both providers configured during migration:

```env
DOMAIN_PROVIDER=cloudflare
DOMAIN_PROVIDER_MIGRATION_TARGET=cloudflare
DOMAIN_PROVIDER_MIGRATION_ROLLBACK_GRACE_HOURS=168

# Keep during rollback window
VERCEL_API_TOKEN=...
VERCEL_PROJECT_ID_OR_NAME=...

CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_ZONE_ID=...
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_SAAS_FALLBACK_ORIGIN=saas-fallback.opygen.com
CLOUDFLARE_SAAS_CNAME_TARGET=customers.opygen.com

# Destructive operator actions remain disabled by default
CLOUDFLARE_PHASE4_ALLOW_VERCEL_REMOVAL=false
CLOUDFLARE_PHASE4_ALLOW_ROLLBACK=false
```

`DOMAIN_PROVIDER=cloudflare` determines the provider for new domain work. It no longer causes persisted Vercel records to be silently re-registered or rewritten by the normal lifecycle evaluator.

## Existing custom domains

All mutating commands require both `--apply` and the confirmation token. Start with `plan`.

```bash
pnpm cloudflare:phase4:domains:plan

pnpm cloudflare:phase4:domains:start -- --organization=<organization-id> --apply --confirm=PHASE4-VERCEL-CLOUDFLARE
pnpm cloudflare:phase4:domains:advance -- --organization=<organization-id> --apply --confirm=PHASE4-VERCEL-CLOUDFLARE
```

`advance` is idempotent. Run it again after the customer satisfies validation records and again after routing DNS is changed. Before the route changes it will stop at `CF_TLS_ACTIVE`; after Cloudflare routing and the public marker are verified it moves to `TRAFFIC_SWITCHED`.

After the rollback grace expires:

```bash
CLOUDFLARE_PHASE4_ALLOW_VERCEL_REMOVAL=true \
  pnpm cloudflare:phase4:domains:finalize -- --organization=<organization-id> --apply --confirm=PHASE4-VERCEL-CLOUDFLARE
```

For rollback, first restore the legacy Vercel DNS records shown by the status/UI and wait until Vercel again serves valid TLS and the Opygen marker. Then:

```bash
CLOUDFLARE_PHASE4_ALLOW_ROLLBACK=true \
  pnpm cloudflare:phase4:domains:rollback -- --organization=<organization-id> --apply --confirm=PHASE4-VERCEL-CLOUDFLARE
```

Bulk rollback is intentionally unavailable; rollback must name one organization.

## Platform root and wildcard cutover

The platform cutover is separate from customer-domain migration. It snapshots only the platform web-routing records and Worker routes so unrelated MX/TXT/DKIM/SPF/API/media records are outside the rollback scope.

```bash
pnpm cloudflare:phase4:platform:plan
```

The default staging gate requires test URLs that prove the Worker, wildcard TLS, tenant resolver, and public marker before production routing is touched:

```env
CLOUDFLARE_PHASE4_STAGING_ROOT_URL=https://<staging-root>
CLOUDFLARE_PHASE4_STAGING_TENANT_URL=https://<staging-tenant>
CLOUDFLARE_PHASE4_STAGING_CUSTOM_URL=https://<staging-custom-domain>
CLOUDFLARE_PHASE4_REQUIRE_STAGING_GATE=true
```

Cutover remains disabled unless explicitly enabled:

```bash
CLOUDFLARE_PHASE4_ALLOW_PLATFORM_CUTOVER=true \
  pnpm cloudflare:phase4:platform:cutover
```

The command refuses cutover unless the advanced certificate covering `realestate.opygen.com` and `*.realestate.opygen.com` is active and the staging gate succeeds. By default it automatically restores the exact pre-cutover platform routing snapshot if the post-cutover production gate fails.

Verify separately:

```bash
pnpm cloudflare:phase4:platform:verify
```

Explicit rollback:

```bash
CLOUDFLARE_PHASE4_ALLOW_PLATFORM_ROLLBACK=true \
  pnpm cloudflare:phase4:platform:rollback
```

The rollback snapshot is integrity-checked and scoped to the configured Cloudflare account, zone, and platform root. Re-running `platform:plan` refreshes the snapshot; `platform:cutover` aborts if platform DNS or Worker routes drift after that plan was captured, so a stale snapshot cannot be used for an automatic rollback.

## Production release order

1. Keep Vercel project/domain registrations and Vercel credentials intact.
2. Run platform `plan`; pass staging gates; perform guarded platform cutover.
3. Migrate a small custom-domain pilot with `start` and `advance`.
4. Confirm `TRAFFIC_SWITCHED` and observe the rollback window.
5. Expand in batches using `plan`/`start`/`advance`.
6. Only after the configured grace period use `finalize` with the explicit Vercel-removal flag.
7. Remove Vercel credentials only after every intended migration is `VERCEL_REMOVED` and the rollback policy is closed.

## Regression tests

```bash
pnpm test:phase4-cloudflare-migration
```

Also run the existing Phase 2/3 Cloudflare suites and the repository's normal production typecheck, lint, test, and build pipeline before deployment.
