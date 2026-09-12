# Cloudflare Phase 3 — DNS, SaaS routing and SSL

This phase is intentionally split into **plan → bootstrap → cutover → verify**. The scripts are idempotent and never delete unrelated DNS records.

## Required backend-only environment

Set the values documented in `.env.example`, including:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_ZONE_ID`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ZONE_NAME=opygen.com`
- `CLOUDFLARE_WORKER_SCRIPT_NAME=opygen-real-estate-frontend`
- `CLOUDFLARE_PLATFORM_ROOT_DOMAIN=realestate.opygen.com`
- `CLOUDFLARE_SAAS_FALLBACK_ORIGIN=saas-fallback.opygen.com`
- `CLOUDFLARE_SAAS_CNAME_TARGET=customers.opygen.com`
- `CLOUDFLARE_APEX_ROUTING_MODE=optional`

The token needs the minimum zone permissions required for: Zone Read, DNS Edit, SSL/Certificates Read+Write (Custom Hostnames/fallback origin and Advanced Certificates), and Workers Routes Read+Write. Never expose this token through `NEXT_PUBLIC_*`.

The script loads `.env` automatically on Node 22. Set `CLOUDFLARE_PHASE3_ENV_FILE` to use another file.

## 1. Add `opygen.com` to Cloudflare and preserve DNS

Import/copy the existing zone into Cloudflare before changing registrar nameservers. Preserve all MX, TXT, SPF, DKIM, DMARC, API, media, verification and other application records.

Run the read-only inventory before delegation if desired:

```bash
pnpm cloudflare:phase3:plan
```

The plan is written to `.cloudflare/phase3-plan.json` (gitignored). Compare that inventory with the current DNS provider. The script does not change registrar nameservers. After the records are complete, point the registrar to the Cloudflare nameservers and re-run the plan until the zone is active/authoritative.

## 2. Deploy the production Worker without routes

From the frontend repository:

```bash
pnpm deploy:vinext:production:unrouted
```

Do not add production routes in Wrangler. This phase owns routes from the backend control-plane script so exclusions are installed before the broad SaaS route.

## 3. Bootstrap Cloudflare for SaaS safely

```bash
pnpm cloudflare:phase3:bootstrap
```

Bootstrap creates/reconciles only:

- proxied originless `AAAA saas-fallback.opygen.com -> 100::`
- proxied `CNAME customers.opygen.com -> saas-fallback.opygen.com`
- Cloudflare for SaaS fallback origin
- an Advanced Certificate request covering `opygen.com`, `realestate.opygen.com`, and `*.realestate.opygen.com`
- Workers route exclusions for every existing zone hostname
- broad `*/* -> opygen-real-estate-frontend` **after** exclusions

During bootstrap, `realestate.opygen.com/*` and `*.realestate.opygen.com/*` remain explicit **no-Worker** routes, so the existing Vercel path is not switched.

Advanced Certificate Manager must be enabled before the certificate can be ordered. The deeper wildcard is required because Universal SSL for `opygen.com` does not cover `*.realestate.opygen.com`.

If another application/DNS hostname is added to `opygen.com` later, run:

```bash
pnpm cloudflare:phase3:sync-routes
```

before sending production traffic to that hostname. This adds a no-Worker exclusion for the new host.

## 4. Cut over the free-subdomain namespace

Do not cut over until the fallback origin is `active` and the Advanced Certificate pack is `active` for all required hostnames.

Review the plan, then set:

```env
CLOUDFLARE_PHASE3_ALLOW_PLATFORM_DNS_REPLACE=true
```

Run:

```bash
pnpm cloudflare:phase3:cutover
```

Cutover changes only the exact platform records (`realestate.opygen.com` and `*.realestate.opygen.com`) to proxied originless Worker records and switches their Worker routes. Existing conflicting records at those two exact names are backed up in the plan inventory and replaced. Unrelated DNS records are untouched.

One wildcard DNS record handles all future free tenant subdomains; no per-account Cloudflare DNS write is performed.

## 5. Live completion gate

Configure one real test tenant and one unrelated custom domain:

```env
CLOUDFLARE_PHASE3_TEST_SUBDOMAIN=test-agency
CLOUDFLARE_PHASE3_TEST_CUSTOM_DOMAIN=www.customer-example.com
CLOUDFLARE_PHASE3_REQUIRE_LIVE_GATE=true
```

Then run:

```bash
pnpm cloudflare:phase3:verify
```

Verification requires Cloudflare authoritative nameservers, correct managed DNS, active wildcard certificate, active fallback origin, the safe route set, and valid HTTPS/Opygen runtime markers for the platform root, test tenant subdomain, and custom domain.

## Customer apex behavior

`CLOUDFLARE_APEX_ROUTING_MODE=optional` is the cost-effective mode. `www.customer.com` is required and uses a standard CNAME. The root/apex is optional and is used when the customer's DNS provider supports CNAME flattening, ALIAS or ANAME. If the apex cannot be routed, Opygen makes `www.customer.com` canonical automatically. Set the mode to `required` only if you intentionally require both apex and `www`; universal apex support across arbitrary DNS providers requires Cloudflare Apex Proxying/Enterprise.
