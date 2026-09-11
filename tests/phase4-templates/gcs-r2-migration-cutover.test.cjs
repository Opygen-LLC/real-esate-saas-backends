const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const exists = (relative) => fs.existsSync(path.join(root, relative))

const config = read('src/config/index.ts')
const storage = read('src/app/module/websiteBuilder/objectStorage.service.ts')
const inventory = read('scripts/storage-migration/inventory-gcs.mjs')
const sippy = read('scripts/storage-migration/sippy.mjs')
const slurper = read('scripts/storage-migration/super-slurper.mjs')
const rewrite = read('scripts/storage-migration/rewrite-gcs-references.mjs')
const verify = read('scripts/storage-migration/verify-gcs-r2.mjs')
const finalize = read('scripts/storage-migration/finalize-cutover.mjs')
const packageJson = JSON.parse(read('package.json'))
const composeProduction = read('docker-compose.production.yml')
const composeCombined = read('docker-compose.combined.yml')
const deletionManifest = read('PHASE5_DELETE_FILES.txt')

test('runtime writes remain R2-only while legacy GCS URL parsing is explicitly migration-gated', () => {
  assert.match(config, /OBJECT_STORAGE_PROVIDER/)
  assert.match(config, /OBJECT_STORAGE_MIGRATION_MODE/)
  assert.match(config, /OBJECT_STORAGE_LEGACY_GCS_PUBLIC_BUCKET_NAME/)
  assert.match(config, /OBJECT_STORAGE_LEGACY_GCS_PRIVATE_BUCKET_NAME/)
  assert.match(config, /\['off', 'sippy'\]/)
  assert.match(storage, /config\.assets\.migration_mode !== 'sippy'/)
  assert.match(storage, /allowedBuckets = new Set/)
  assert.match(storage, /legacyGcsReferenceKey/)
  assert.doesNotMatch(storage, /@google-cloud\/storage/)
})

test('inventory records migration-critical metadata and database references', () => {
  for (const token of ['key', 'bucket', 'size', 'contentType', 'updatedAt', 'visibility', 'tenant', 'databaseReferences']) {
    assert.ok(inventory.includes(token), `inventory is missing ${token}`)
  }
  assert.match(inventory, /orphanCandidates/)
  assert.match(inventory, /Do not use orphanCandidates for deletion decisions/)
})

test('Sippy configuration is guarded and maps exact GCS sources to exact R2 destinations', () => {
  assert.match(sippy, /\/r2\/buckets\/\$\{encodeURIComponent\(mapping\.destination\)\}\/sippy/)
  assert.match(sippy, /provider:\s*'gcs'/)
  assert.match(sippy, /provider:\s*'r2'/)
  assert.match(sippy, /SIPPY_ENABLE_CONFIRM/)
  assert.match(sippy, /SIPPY_DISABLE_CONFIRM/)
})

test('Super Slurper bulk migration always skips existing R2 objects', () => {
  assert.match(slurper, /\/slurper\/source\/connectivity-precheck/)
  assert.match(slurper, /\/slurper\/target\/connectivity-precheck/)
  assert.match(slurper, /overwrite:\s*false/)
  assert.match(slurper, /SLURPER_CREATE_CONFIRM/)
  assert.match(slurper, /SLURPER_MUTATION_CONFIRM/)
})

test('reference rewrite is destination-verified, dry-run first and separately guards private references', () => {
  assert.match(rewrite, /headR2Object/)
  assert.match(rewrite, /GCS_REFERENCE_REWRITE_CONFIRM/)
  assert.match(rewrite, /GCS_PRIVATE_REFERENCE_REWRITE_CONFIRM/)
  assert.match(rewrite, /rewrite-private-to-key/)
  assert.match(rewrite, /mode:\s*applying \? 'apply' : 'dry-run'/)
})

test('migration verifier does not trust ETags and verifies bytes/image decodability', () => {
  assert.match(verify, /sha256/)
  assert.match(verify, /sharp\(/)
  assert.match(verify, /contentTypeMismatches/)
  assert.match(verify, /privateBlocked/)
  assert.match(verify, /cutoverReady/)
  assert.match(verify, /ETags are intentionally not compared/)
  assert.match(verify, /bucketMappings/)
})

test('final cutover gate fails closed on database refs, Sippy, active jobs, legacy SDK/env and migration mode', () => {
  assert.match(finalize, /verification_report_cutover_ready/)
  assert.match(finalize, /database_has_no_legacy_gcs_urls/)
  assert.match(finalize, /sippy_disabled_\$\{scope\}/)
  assert.match(finalize, /no_active_super_slurper_jobs/)
  assert.match(finalize, /google_cloud_storage_sdk_removed/)
  assert.match(finalize, /legacy_gcs_runtime_credentials_removed/)
  assert.match(finalize, /runtime_migration_mode_off/)
})

test('normal containers receive no GCS migration credential or Cloudflare migration token', () => {
  const combined = `${composeProduction}\n${composeCombined}`
  assert.match(combined, /OBJECT_STORAGE_MIGRATION_MODE/)
  assert.match(combined, /OBJECT_STORAGE_LEGACY_GCS_PUBLIC_BUCKET_NAME/)
  assert.doesNotMatch(combined, /GCS_MIGRATION_SERVICE_ACCOUNT/)
  assert.doesNotMatch(combined, /CLOUDFLARE_API_TOKEN/)
  assert.doesNotMatch(combined, /GOOGLE_APPLICATION_CREDENTIALS/)
})

test('Google storage SDK and obsolete GCS CORS artifacts are removed', () => {
  const dependencies = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) }
  assert.equal(dependencies['@google-cloud/storage'], undefined)
  assert.equal(exists('scripts/setup-gcs-cors.js'), false)
  assert.equal(exists('ops/gcs-cors.json'), false)
  assert.match(deletionManifest, /scripts\/setup-gcs-cors\.js/)
  assert.match(deletionManifest, /ops\/gcs-cors\.json/)
})

test('operator package commands expose the complete migration/cutover workflow', () => {
  for (const command of [
    'storage:migration:inventory',
    'storage:migration:sippy',
    'storage:migration:slurper',
    'storage:migration:rewrite-refs',
    'storage:migration:verify',
    'storage:migration:finalize',
  ]) assert.ok(packageJson.scripts?.[command], `missing ${command}`)
  assert.equal(exists('ops/R2_GCS_MIGRATION_RUNBOOK.md'), true)
  assert.equal(exists('scripts/storage-migration/migration.env.example'), true)
})
