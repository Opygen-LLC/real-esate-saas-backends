# Phase 2: paired updated-files patch

## Release status: BLOCKED - NOT PRODUCTION CERTIFIED

The implementation is supplied as a reviewable release candidate, not a verified production deployment. Project dependency installation failed in the implementation environment (registry DNS EAI_AGAIN). Full repository typechecks were attempted and exited 2 with unresolved dependencies/types. Production builds, real database tests, browser tests, query profiling and visual baselines could not be executed. Do not deploy this patch as a certified release until the gates below pass. See `docs/phase2/validation.json`, executed-test logs and `environment-evidence.md`.

## Applying the patch

This ZIP contains only added/changed files relative to the ORIGINAL UPLOAD + PHASE 1 PATCH. It is not a complete application. Apply the Phase 1 frontend/backend ZIPs first, respecting their deletion instructions. Then extract each Phase 2 ZIP at its corresponding repository root, preserving relative paths and replacing matching files. Do not extract one repository's patch into the other. Phase 2 requires no file deletions and makes no dependency changes; the Phase 1 pnpm lockfiles remain authoritative. Package scripts were added without changing dependency specifications.

Use Node >=22.16.0 <23 and pnpm 10.27.0. Install with `corepack pnpm install --frozen-lockfile` after confirming registry access. Existing environment configuration remains required. Never copy real credentials or production customer records into tests.

`PHASE2-CHANGED-FILES.json` lists changed-file hashes and the baseline commit identifying this patch's local comparison point. The repository's own Git commit IDs need not match that local audit commit. Keep a backup or commit of your current working tree before overlaying.

## What changed

- A single backend-owned, generated contract defines property enums/policies, canonical URL queries, public DTOs, effective-price and area rules, content patches, template manifests and publication revision validation. The frontend's generated copies are not hand-maintained schemas.
- Catalog filters originate from validated URL state. `type`, `location`, and `q` aliases normalize to `propertyType`, `city`, and `searchTerm`. Legacy Plot becomes LandPlot; Penthouse/Duplex remain free-text intent rather than invented database enums. Invalid filters show an error and remain recoverable instead of fetching an unrelated broad catalog.
- Backend price/area computation, filtering and stable sorting run BEFORE pagination and use the same predicates for counts. Client page-local price sorting is removed. The unique `_id` tie-break remains. Public membership/sorting cannot use a hidden price or hidden area to reveal it.
- Public DTOs whitelist nested fields and normalize ObjectIds/dates to their wire format. Tenant-scoped selection reads resolve Studio-curated property IDs to current public records, not copied prices or titles.
- RTK Query paginated lists carry `PARTIAL-LIST` and record tags. Mutations invalidate affected lists as well as records. Public viewing submission invalidation from Phase 1 is preserved. These tags refresh the current Redux store; they are not a claim of cross-browser push updates.
- A versioned ten-template manifest controls supported editor fields, image slots, pages, section visibility, defaults and design capabilities. The generic Studio editor consumes those fields; the actual renderer consumes the same manifest/visibility contract.
- Shared why-choose-us and actual-agent sections bind previously ignored homepage fields. These are content-binding fixes, not the Phase 4 eight-template redesign. Template 1/2 layout classes/styles were not redesigned; search, empty-record handling, blank-content behavior and captions were corrected. Their old source-byte checksum is not a valid Phase 2 visual proof. Existing visual comparison gates still need to run.
- Empty live catalogs/agent lists no longer inject fictional records for tenants named `agency` or `demo`. Previews should pass explicit sample records through the existing preview mechanism; sample records are never inferred from a public tenant identifier.
- Template switching/content updates merge fields and fill only absent defaults. Explicit `false`, empty strings, empty arrays and existing tenant/legacy values are preserved. New invalid/unknown marketing fields and unsafe links are rejected. Revision checks prevent lost updates. Ordinary content save no longer forces `renderMode: 'template'`.

## Exact semantics

A visible effective price is a finite, positive price. A discount applies only when enabled, positive, below that price, and not hidden. Hidden or missing prices serialize as `effectivePrice: null`, `priceStatus: on_request`; they sort last in BOTH directions and do not satisfy numeric budget filters. Hiding the discount uses the original visible price. BDT money formatting is shared; explicit YEARLY pricing wins over the ForRent category. Numeric sort compares displayed amounts, not inferred annualized investment values. Use listing purpose/pricing mode to compare like-for-like rentals and sales.

`minUnitRate`/`maxUnitRate` address the advertised rate in `pricing.unitRate`, not a fabricated discounted per-unit amount. Select a pricing mode when comparing rates. Area range inputs are converted using the tenant's explicit area factors; their default input unit is square feet. Area unit alone now qualifies a range, rather than selecting only records stored in that unit. Missing/unknown stored units are not guessed. Date-only availability ends at 23:59:59.999 Asia/Dhaka. Public search matches all escaped words across permitted public fields; it is limited to 12 words and 120 characters. Regex text is escaped; inputs cannot supply MongoDB operators. Query time limits are applied, but no latency target is certified.

Homepage curated selections store IDs and ordering only (up to 24 featured IDs plus an optional hero reference). Newly selected records must be public, unlocked and owned by the tenant. Existing archived references survive unrelated edits without being copied into marketing content; unavailable records are omitted by the public resolver. Legacy promotional hero-card content remains preserved until the owner selects a canonical property.

The manifest has version 1 and marketing content schema version 2. A newer unsupported stored content version fails closed for writes. Legacy extra fields remain in stored content but are excluded from the defensive public-render projection. Collection updates replace the specific submitted collection, never the entire page. No new database index or materialized price field was added.

## Required release gates

1. Successful frozen dependency installs in BOTH repositories. Run the existing repository lint/format/type/build/test checks in addition to the new gates; the new focused gates are not a replacement for the full CI suite.
2. Backend: `node scripts/sync-website-catalog-contracts.mjs --frontend ../frontend --check` (substitute your actual sibling frontend path). Frontend: `pnpm verify:phase2-contracts`.
3. Backend: `pnpm test:phase2-catalog`, `pnpm test:phase1-unit`, `pnpm typecheck`, `pnpm typecheck:test`, `pnpm build`. Run the real Mongo suite with `PHASE2_TEST_DATABASE_URL` pointing to a dedicated database named `phase2_catalog_test` or `phase2_catalog_test_<suffix>`: `pnpm test:phase2-catalog:integration`. It creates/drops ONLY a uniquely named fixture collection, never a whole database. It fails instead of silently skipping without configuration.
4. Frontend: `pnpm test:phase2-catalog`, `pnpm typecheck`, `pnpm build`, then `PHASE2_CATALOG_URL=https://your-staging-tenant/properties pnpm test:e2e:phase2-catalog`. Use an isolated template-1 fixture without listing/card overrides and with at least four public records, including a discount; install the Playwright Chromium browser. The tests make real read-only browser/API requests and check refresh/back, invalid ranges, and server/UI ordering over two pages. Run mobile and all-theme QA, authenticated Studio saves/template switching and image editing separately.
5. Re-run existing template-1/2 Playwright screenshots using the Phase 1 fixture and genuinely approved baselines. No screenshots are included or claimed captured in this patch. Do not auto-accept new baselines as evidence that the old appearance was preserved.
6. Reconcile the existing failing `runtime code does not depend on Unsplash fallbacks` rule. The remaining fallback is in Template2Luxury.tsx; it was retained rather than silently changing template 2's imagery or disabling the security/release test. Replace it with an approved managed asset, or explicitly review the external-image policy. Current full frontend source-pattern tests: 530 pass / 1 fail.
7. Run representative read-only query profiles and the migration dry run below against staging data. Review actual explain output before proposing any indexes. Deploy the backend first, then the matched frontend. Canary a tenant, verify saves/search/property privacy and current content, and retain the prior release for rollback.

## Operational notes

A content save still uses the application's existing publish lifecycle. A complete Draft / Preview / Publish redesign and dirty-input workspace protection are Phase 3, not claims of this Phase 2 patch. Some historical decorative marketing claims and the complete template redesign remain Phase 4 work. Do not treat passing a source-pattern test or a dependency-free adapter test as a real browser, database or security certification.

The actual executed checks are 26 backend Phase 2 tests, 128 backend Phase 1 adapter tests, 19 frontend Phase 2 tests, and the 531 existing frontend checks (530 pass, one known failure). Template binding tests execute real template functions through an explicit JSX adapter, not React DOM. The runtime visibility adapter exercises all four flags across all ten templates. Strict typechecking passed for the six standalone shared modules only. All broader verification limitations are machine-readable in `docs/phase2/validation.json`.

## Contract maintenance

Edit ONLY `backend/src/contracts/websiteCatalog/*.ts`. Run the backend sync script with `--frontend <actual-frontend-root>`, commit BOTH generated manifests and frontend outputs, and run `--check` in CI. Frontend local hash validation catches edited generated files; only the paired cross-repository check proves parity with backend authority. Never maintain a new handwritten fallback registry.
