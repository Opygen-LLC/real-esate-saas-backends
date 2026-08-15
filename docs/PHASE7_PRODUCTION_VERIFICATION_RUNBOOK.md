# Phase 7 — Backend production verification

Phase 7 makes the server release gate exercise the production architecture instead of only compiling source.

## CI infrastructure

`docker-compose.ci.yml` starts:

- MongoDB 7 as a replica set so transactions are actually tested;
- Redis;
- MinIO with a real test bucket;
- ClamAV.

The release journey uses real MinIO uploads and real ClamAV scanning. The remote HTTPS image source is deterministic/mocked at the HTTP boundary so the suite does not depend on a third-party website, while the imported bytes still travel through the application's storage and malware-scan pipeline.

## Required commands

```bash
corepack enable
pnpm install --frozen-lockfile
docker compose -f docker-compose.ci.yml up -d --wait

pnpm format:check
pnpm lint
pnpm typecheck
pnpm typecheck:test
pnpm build
pnpm test:unit
pnpm test:contract
pnpm test:security
pnpm test:integration
pnpm test:migrations
pnpm verify:phase7-architecture
```

For the full Phase 7 journey, set `PHASE7_MEDIA_INTEGRATION=true` plus the MinIO/ClamAV variables used by `.github/workflows/ci.yml`.

## End-to-end release journey

`src/tests/integration/phase7ReleaseJourney.integration.test.ts` verifies:

1. register agency;
2. OTP verification;
3. Bangla onboarding;
4. create draft property;
5. upload and malware-scan 20 photos;
6. enforce the 20-photo maximum;
7. import a public HTTPS image through the hardened import pipeline;
8. add YouTube and Matterport media;
9. normalize the Matterport item into the single safe hero embed;
10. publish the website and property using agency publishing permission;
11. submit a public enquiry;
12. schedule a viewing using the agency fallback assignment path;
13. request a Professional-plan upgrade;
14. record a manual payment as super-admin;
15. confirm it atomically;
16. verify subscription activation;
17. verify the agency receipt;
18. verify super-admin revenue/active-subscription totals.

## Migration verification

`pnpm test:migrations` uses a disposable database whose URL must clearly contain `test`, `migration`, or `phase7`. It seeds legacy moderation, support/compliance, bKash-source, billing and property-media records, runs the canonical migrations twice, verifies post-migration invariants, and requires backup manifests/checksums from destructive migrations.

Never point migration tests at production data.

## Release policy

Do not deploy unless frontend and backend CI both pass for the paired release. Run production smoke checks (`/health`, `/ready`, frontend `/healthz`) after deployment and roll back if readiness is not green.
