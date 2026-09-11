# GCS -> Cloudflare R2 production migration runbook

This runbook moves existing media without changing the application write path back to GCS. New application writes remain R2-only throughout the migration.

## Safety model

- Run migration commands from a locked-down one-off shell/job, not from the API container.
- Copy `scripts/storage-migration/migration.env.example` to a secret-managed environment outside source control.
- The GCS service account should be read-only for the two source buckets.
- The R2 access key should be bucket-scoped to the intended destination buckets.
- The Cloudflare API token should have only the R2 migration/Sippy permissions required for the operation.
- Keep GCS intact and read-only through the rollback window. Do not delete source objects based only on an orphan scan.
- Never compare GCS/R2 ETags as a migration integrity check. The verifier uses metadata plus sampled SHA-256 and image decoding.

## 1. Configure migration-only environment

Set the migration shell variables from `scripts/storage-migration/migration.env.example`:

```text
DATABASE_URL
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_PUBLIC_BUCKET_NAME
R2_PRIVATE_BUCKET_NAME
R2_ENDPOINT
OBJECT_STORAGE_PUBLIC_BASE_URL
GCS_MIGRATION_PUBLIC_BUCKET_NAME
GCS_MIGRATION_PRIVATE_BUCKET_NAME
GCS_MIGRATION_SERVICE_ACCOUNT_FILE (preferred) or GCS_MIGRATION_SERVICE_ACCOUNT_JSON
CLOUDFLARE_API_TOKEN
```

Do not add the GCS service-account JSON/key or `CLOUDFLARE_API_TOKEN` to the normal API/worker production environment.

## 2. Inventory GCS before any migration mutation

```bash
pnpm storage:migration:inventory
```

Optional tenant/prefix scoping is available with `--tenant=<organizationId>` or `--prefix=<key-prefix>`.

Review the generated JSONL manifest and summary. The manifest contains object key, source/destination bucket, size, content type, update time, visibility, tenant, checksums/generation metadata, and MongoDB references. Treat `orphanCandidates` only as review candidates; never delete automatically from that count.

## 3. Deploy R2-only writes with temporary legacy-read compatibility

Normal production environment:

```text
OBJECT_STORAGE_PROVIDER=r2
OBJECT_STORAGE_MIGRATION_MODE=sippy
OBJECT_STORAGE_LEGACY_GCS_PUBLIC_BUCKET_NAME=<old-public-gcs-bucket>
OBJECT_STORAGE_LEGACY_GCS_PRIVATE_BUCKET_NAME=<old-private-gcs-bucket>
```

Frontend build environment during the migration window:

```text
NEXT_PUBLIC_OBJECT_STORAGE_MIGRATION_MODE=sippy
NEXT_PUBLIC_LEGACY_GCS_PUBLIC_BUCKET_NAME=<old-public-gcs-bucket>
```

Redeploy API/worker and rebuild/redeploy Next.js. R2 remains the only application write target. The temporary compatibility parser accepts legacy URLs only from the exact configured GCS buckets; the frontend canonicalizes only the configured legacy public bucket to the R2 public origin.

## 4. Enable Sippy on both destination buckets

Check current state first:

```bash
pnpm storage:migration:sippy status
```

Then enable deliberately:

```bash
SIPPY_ENABLE_CONFIRM=enable-gcs-to-r2-sippy pnpm storage:migration:sippy enable
```

Sippy now fills missing R2 objects from the matching GCS source when those R2 objects are requested.

## 5. Precheck and start Super Slurper bulk copy

```bash
pnpm storage:migration:slurper precheck
SLURPER_CREATE_CONFIRM=start-gcs-to-r2-migration pnpm storage:migration:slurper create
pnpm storage:migration:slurper list
```

The create command always sends `overwrite: false`, so R2 objects already written by the application or populated through Sippy are skipped rather than replaced.

Inspect individual jobs:

```bash
pnpm storage:migration:slurper status -- --job-id=<job-id>
pnpm storage:migration:slurper logs -- --job-id=<job-id>
```

Pause/resume/abort are guarded by `SLURPER_MUTATION_CONFIRM=allow-<action>-migration-job`.

## 6. Verify copied objects before changing database references

While legacy database URLs still exist, first verify object parity with:

```bash
pnpm storage:migration:verify -- --allow-legacy-refs
```

Do not continue until object verification passes. The verifier checks object existence, size, content type, deterministic sampled SHA-256, image decodability, public HTTP access, and private unsigned/signed access behavior.

## 7. Rewrite legacy GCS URLs in MongoDB

Preview only:

```bash
pnpm storage:migration:rewrite-refs
```

Review the report. Public URLs are mapped to `OBJECT_STORAGE_PUBLIC_BASE_URL/<same-key>`. The script confirms the destination R2 object exists before updating and uses an old-value match to avoid overwriting concurrent edits.

Apply public URL rewrites:

```bash
GCS_REFERENCE_REWRITE_CONFIRM=rewrite-gcs-references-to-r2 pnpm storage:migration:rewrite-refs -- --apply
```

Private references are intentionally not converted to public URLs. If your legacy database contains private GCS URLs and the application field expects an object key, use the separately guarded private-key rewrite only after reviewing those fields:

```bash
GCS_REFERENCE_REWRITE_CONFIRM=rewrite-gcs-references-to-r2 \
GCS_PRIVATE_REFERENCE_REWRITE_CONFIRM=private-gcs-urls-to-object-keys \
pnpm storage:migration:rewrite-refs -- --apply --rewrite-private-to-key
```

## 8. Run final R2 verification

Run without `--allow-legacy-refs`:

```bash
pnpm storage:migration:verify
```

Keep the generated verification report. `cutoverReady` must be `true`, and MongoDB must contain zero configured legacy GCS URL references.

Also run normal product regression coverage for property media, Website Studio branding/favicon/media, avatars, organization branding, support attachments, supplier invoices, private downloads, tenant deletion/purge, invoice branding, and public rendering.

## 9. Disable Sippy and switch migration mode off

Only after the clean verification report:

```bash
SIPPY_DISABLE_CONFIRM=disable-gcs-to-r2-sippy pnpm storage:migration:sippy disable
pnpm storage:migration:sippy status
```

Set the normal backend environment to:

```text
OBJECT_STORAGE_MIGRATION_MODE=off
```

Rebuild the frontend with:

```text
NEXT_PUBLIC_OBJECT_STORAGE_MIGRATION_MODE=off
```

Then redeploy both. This removes legacy GCS image allowlisting/canonicalization from the built frontend and disables legacy GCS reference resolution in the API.

## 10. Run the final cutover gate

With `OBJECT_STORAGE_MIGRATION_MODE=off`, `DATABASE_URL`, R2 variables, the migration source bucket names, and `CLOUDFLARE_API_TOKEN` available in the one-off migration shell:

```bash
pnpm storage:migration:finalize -- --verification-report=./migration-reports/<clean-verification-report>.json
```

The finalizer fails closed unless: the supplied verification report is cutover-ready, database GCS references are gone, Sippy is disabled, no matching Super Slurper job is active/paused/queued, `@google-cloud/storage` is absent, old GCP storage runtime environment names are absent, and migration mode is off.

## 11. Rollback window and final source retirement

Keep GCS read-only for the agreed rollback window and monitor R2 read/write health, upload/processing latency, 403/404 rate, storage accounting, public image rendering, private signed downloads, and R2 operations.

After the rollback window and a second successful verification/finalizer run:

1. Revoke the GCS migration service account and Cloudflare migration-only API token.
2. Remove migration-only secrets from the one-off environment/secret manager.
3. Archive the inventory, verification, rewrite, and cutover reports securely.
4. Delete GCS source data only under an explicit, separately reviewed retention/deletion procedure.
5. Keep `OBJECT_STORAGE_MIGRATION_MODE=off`; migration compatibility code is dormant and can be removed in a later cleanup release after the rollback window.

The application must never resume writes to GCS during this process.
