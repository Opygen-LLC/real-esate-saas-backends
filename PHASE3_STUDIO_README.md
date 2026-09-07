# Phase 3 - Website Studio patch

## Delivery status and prerequisites

This is an incremental source patch, not a full project or a certified production build. Apply it to the corresponding original project **after both the Phase 1 and Phase 2 patches**. ZIP paths are relative to the project root. Back up the checkout and database first. Do not extract into an extra nested application directory. No files must be deleted for this patch.

`PATCH-MANIFEST.phase3.json` records the pre-patch and post-patch SHA-256 of every included source/documentation file except the manifest itself. A mismatched pre-patch hash means your checkout differs from the supplied Phase 2 baseline; merge that file rather than overwriting your subsequent work. An already matching post-patch hash means that file is already applied.

Use the retained project pin: Node 22.16 or another allowed 22.x release, and pnpm 10.27.0. No dependencies or dependency resolutions were changed in this phase; keep the existing pnpm lockfile. Both applications must be updated together. The backend contract directory is authoritative; generated frontend contract copies must not be edited independently.

**Release verification is incomplete in this environment.** The frozen installation attempt failed before pnpm/dependency installation because the package registry could not be resolved (`EAI_AGAIN`). Global TypeScript checks also failed with missing project dependencies/types; these are not passing typechecks. Production builds, real MongoDB integration tests, object-storage/worker tests, browser journeys, and visual screenshots could not run. No placeholder image has been presented as a captured screenshot. Run and pass the release checks below before deploying this patch to a live tenant.

Executed checks across both projects: **731 Node tests passed, zero failed or skipped**, plus matching copies of all nine shared contract files and a source syntax parse. The existing suites include source assertions; new backend transaction tests use an explicit in-memory repository/transaction adapter. These results do not establish actual MongoDB transaction behavior or browser correctness. See `docs/phase3-studio/verification.json` and included test logs.

## Included behavior

- One compact Studio with Content, Design, Branding, Viewing & Inquiry, SEO, Domain, and Analytics. Templates, component selection, and animations are inside Design.
- Draft content is separate from live organization settings. Save does not publish or switch the rendering mode. Publication is an explicit compare-and-swap operation. Restore copies an immutable previous publication into a new draft; the owner must preview and publish it separately.
- Per-area dirty state, navigation confirmation, field errors, stale refetch protection, conflict recovery/export, revision checks, and request IDs for safe retries.
- The preview iframe uses the actual seven public page renderers. Desktop/tablet/mobile widths are real iframe viewports. Your content and illustrative sample content are explicit modes. Preview prevents writes, inquiry/viewing submissions, analytics, and realtime connections.
- Marketing headings, text, CTA labels/destinations, supported collections and section visibility/order bind to the shared contracts. Hero/about/gallery image slots support alternative text, decorative flags, fit, and focal points. Canonical listing/agent facts and property images remain in their existing business records.
- Tenant-owned image upload/library/import, processing status, provenance and reference-aware deletion. Drafts, retained publications, builder pages/history and property records protect their referenced assets from deletion. Storage cleanup is a retryable worker job.
- Two optional curated standard-license Unsplash choices import through the existing scanned asset pipeline. No live Unsplash API integration, credentials, Unsplash+ assets, or bundled image binaries were added. Source/license/photographer metadata is retained. Recheck rights for your use; default images are illustrative agency imagery, not evidence about a listed property. Original template 2 fallback photographs were not silently replaced.

## Scope and compatibility notes

Templates 1 and 2 were not visually redesigned. Their renderer code did receive shared media/visibility/preview bindings, so visual comparison remains a required gate. The eight redesigns belong to Phase 4 and are not in this patch.

Existing advanced-builder content remains editable in its existing builder workspace. Studio preserves builder render mode and freezes builder page snapshots for explicit publication/restoration; it does not replace the advanced page editor. Legacy direct-publication endpoints remain for compatibility and will advance the publication revision, causing a stale Studio session to require conflict resolution rather than silently overwrite them.

Domain provisioning and analytics are separate operational panels, not editable marketing snapshots. Retained revision history intentionally keeps referenced assets in use; no automatic history-pruning policy is introduced. A separate retention policy is needed before allowing removal of those historical assets.

The screenshot generation pipeline is included, but generated screenshot assets are **not included** because a running dependency-installed frontend was unavailable. Until real captures are produced, the template picker offers an on-demand actual-render preview rather than fake thumbnail images. The release verifier deliberately rejects missing or stale captures.

## Safe acceptance checklist

Before production, use a disposable tenant and verify: save without changing the live site; reload without losing a saved draft; reject a stale second writer; preview both content modes and widths; replace/crop an image; edit collections and hide/reorder supported sections; switch templates without losing tenant content; preserve builder mode; publish exactly once under a retried request; restore a historical revision into draft and publish it; deny cross-tenant/private writes; prevent deletion of referenced images; and process allowed unreferenced deletion through the worker. Verify published pages and preview agree for the same revision and canonical data.

Keep a verified application/database backup. If a migration or acceptance check fails, do not publish. If deployment must be rolled back, stop or drain the new asset-cleanup jobs before reverting workers, restore a known compatible frontend/backend pair, and retain the additive Studio collections for investigation. Do not drop customer data or overwrite current revisions as an automated rollback shortcut.

## Backend setup, migration, and checks

Run from the backend root after applying both patches:

```sh
corepack enable
corepack pnpm install --frozen-lockfile
pnpm typecheck
pnpm typecheck:test
pnpm test:phase1-unit
pnpm test:phase2-catalog
pnpm test:phase3-studio
pnpm build
```

Use the existing `.env.example` and your secret manager. In particular, configure `DATABASE_URL` for a replica set or mongos; preserve valid auth/CSRF/BFF settings; configure tenant object storage (`GCP_PROJECT_ID`, `GCP_BUCKET_NAME`, `GCP_KEY_FILE` or deployment identity, `OBJECT_STORAGE_PUBLIC_BASE_URL`, and allowed browser origin) and its existing CORS/scan settings. A standalone MongoDB is deliberately not accepted for Studio writes. No secrets are included.

After a verified database backup and before accepting Studio writes, create the new additive collections/indexes:

```sh
pnpm migrate:phase3-studio -- --apply
```

The migration uses the normal configured `DATABASE_URL`. It checks transaction capability, creates missing registered collections, and creates the three Studio models' indexes. It does not replace, migrate, reset or publish any tenant's content. Drafts initialize lazily from current live values. Plan this operation and verify its output under your normal database change policy.

The existing worker must be running with the same code version (`WORKER_ENABLED=true` for the appropriate worker process). Both the existing publication-outbox processing and the new `website_asset_delete` job require a healthy worker and correctly configured storage. Public cache propagation happens after the committed publication event is processed; test this with the deployed cache/CDN configuration. Do not deploy API code with an old worker that cannot recognize the new job type.

### Real replica-set integration gate

Use the retained local test compose file. This test deliberately drops its own guarded database; never point it at a shared or production database.

```sh
docker compose -f compose.phase1-test.yml up -d --wait
export TEST_DATABASE_URL='mongodb://127.0.0.1:27018/phase1_studio_integration?replicaSet=rs0&directConnection=true'
# Preserve the normal test JWT/configuration environment required by this application.
pnpm test:phase3-studio:integration
```

The URL guard requires loopback, a `phase1_studio_*` database and `directConnection=true`. Missing configuration or an unavailable replica set fails the gate rather than skipping it. The suite exercises real authenticated routes, simultaneous stale writers, transaction rollback after an injected post-write outbox failure, idempotent publish/restore and tenant/media rejection. It was supplied but **not executed** in this environment.

`pnpm gate:phase3-studio` combines production/test typechecks, build, Phase 1/2/3 Node tests and this real database integration gate. Also run your existing broader permission, public API, object-storage, compliance and deployment security checks.

For sibling checkouts, verify generated contracts from the backend:

```sh
node scripts/sync-website-catalog-contracts.mjs --frontend ../frontend --check
```

Replace `../frontend` with the actual frontend path. To regenerate after a deliberate authoritative contract change, run the same script without `--check`, then review and commit both outputs.

### API lifecycle

All new endpoints are below `/api/v1/organization/website`, authenticated, tenant-scoped, require `website.write`, and send private/no-store responses.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/studio` | Current draft state and publication revisions. |
| PUT | `/studio/draft` | Save a validated minimal draft patch; never publish. |
| POST | `/studio/publish` | Publish the exact expected saved draft. |
| POST | `/studio/restore` | Copy a historical publication into a new draft. |
| POST | `/studio/reset` | Reset draft from current live state explicitly. |
| GET | `/studio/history` | Revision history for the current tenant. |
| GET | `/studio/preview?draftRevision=N` | Saved revision's explicit public preview data. |
| GET | `/studio/assets` | Cursor-paginated tenant website-image library. |
| GET | `/assets/:id/usage` | Explain references that protect an asset. |

Save/publish/restore/reset requests carry `expectedDraftRevision`, `expectedPublicationRevision` and a UUID `mutationId`; restore also carries the target `revision`. Reuse the same UUID and body when retrying an uncertain response. A mismatched UUID payload is rejected; stale revision conflicts return 409. Receipts are retained for 24 hours; after that, revision comparison still prevents an old request overwriting newer state. Refresh and reconcile instead of bypassing the check.

The durable collections are `WebsiteStudio`, `WebsiteStudioRevision` and `WebsiteStudioReceipt` model collections. Snapshots preserve dotted UI media-slot names through nested durable serialization. Publication creates history and its outbox work in the same transaction. Snapshot/history access is never exposed through the public organization serializer. Tenant export/purge includes the new collections.

### Source map

- `src/app/module/websiteBuilder/websiteStudio.*`: models, validation, service and controller.
- `websiteStudioAssets.policy.ts`, `websiteAssetUsage.service.ts`: tenant ownership and reference policies.
- `src/app/module/operationsQueue/`: retryable asset cleanup job.
- `src/contracts/websiteCatalog/`: authoritative shared contracts and image provenance.
- `src/app/db/migratePhase3WebsiteStudio.ts`: additive migration.
- `tests/phase3-studio/`: executed in-memory lifecycle/failure tests.
- `src/tests/integration/phase3StudioLifecycle.integration.test.ts`: required real-database gate, not executed here.
