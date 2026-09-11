#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import {
  arg,
  fail,
  migrationBuckets,
  readJson,
  redactError,
  timestampSlug,
  writeJson,
} from './lib/common.mjs'
import { cloudflareContext, cloudflareRequest } from './lib/cloudflare.mjs'
import { closeMigrationDatabase, scanGcsReferences } from './lib/mongo-references.mjs'

const reportPath = path.resolve(arg('verification-report').trim())
if (!arg('verification-report').trim()) {
  fail('Usage: node scripts/storage-migration/finalize-cutover.mjs --verification-report=./migration-reports/<verification>.json [--output=...]')
}
if (!fs.existsSync(reportPath)) fail(`Verification report does not exist: ${reportPath}`)

const verification = readJson(reportPath)
const buckets = migrationBuckets()
const requiredBucketPairs = [
  ['public', buckets.gcsPublic, buckets.r2Public],
  ['private', buckets.gcsPrivate, buckets.r2Private],
]
const missing = requiredBucketPairs.flatMap(([scope, source, target]) => [
  ...(!source ? [`${scope}:GCS`] : []),
  ...(!target ? [`${scope}:R2`] : []),
])
if (missing.length) fail(`Missing migration bucket configuration: ${missing.join(', ')}`)

const outputPath = path.resolve(arg(
  'output',
  path.join(process.cwd(), 'migration-reports', `cutover-final-${timestampSlug()}.json`),
))

const checks = []
const pushCheck = (name, ok, detail = null) => checks.push({ name, ok: Boolean(ok), detail })

pushCheck(
  'verification_report_cutover_ready',
  verification?.cutoverReady === true,
  verification?.cutoverReady === true ? null : 'Run storage:migration:verify until the report has cutoverReady=true.',
)

const reportMappings = new Set(
  (verification?.bucketMappings || verification?.scopes || verification?.results || [])
    .map((entry) => `${entry?.sourceBucket || entry?.gcsBucket || ''}->${entry?.destinationBucket || entry?.r2Bucket || ''}`)
    .filter((entry) => !entry.startsWith('->') && !entry.endsWith('->')),
)
for (const [scope, source, target] of requiredBucketPairs) {
  if (reportMappings.size) {
    pushCheck(
      `verification_report_${scope}_mapping`,
      reportMappings.has(`${source}->${target}`),
      `${source} -> ${target}`,
    )
  }
}

if (String(process.env.OBJECT_STORAGE_MIGRATION_MODE || 'off').trim().toLowerCase() !== 'off') {
  pushCheck('runtime_migration_mode_off', false, 'Set OBJECT_STORAGE_MIGRATION_MODE=off for final cutover.')
} else {
  pushCheck('runtime_migration_mode_off', true)
}

let dbScan = null
try {
  dbScan = await scanGcsReferences({
    gcsBuckets: [buckets.gcsPublic, buckets.gcsPrivate],
    maxDocuments: 0,
  })
  pushCheck(
    'database_has_no_legacy_gcs_urls',
    dbScan.referencesFound === 0,
    dbScan.referencesFound === 0 ? null : `${dbScan.referencesFound} legacy GCS URL/reference(s) remain. Run storage:migration:rewrite-refs and verify again.`,
  )
} catch (error) {
  pushCheck('database_has_no_legacy_gcs_urls', false, redactError(error))
} finally {
  await closeMigrationDatabase()
}

try {
  const { accountId } = cloudflareContext()
  for (const [scope, , target] of requiredBucketPairs) {
    const endpoint = `/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(target)}/sippy`
    try {
      const status = await cloudflareRequest(endpoint)
      pushCheck(
        `sippy_disabled_${scope}`,
        !status?.enabled,
        status?.enabled ? `Sippy is still enabled on ${target}. Disable it only after successful verification and reference rewrite.` : null,
      )
    } catch (error) {
      // Cloudflare can respond with a not-configured/not-found shape after Sippy is removed.
      const message = redactError(error)
      const notConfigured = /404|not found|not configured|sippy configuration/i.test(message)
      pushCheck(`sippy_disabled_${scope}`, notConfigured, notConfigured ? 'No Sippy configuration is present.' : message)
    }
  }

  try {
    const result = await cloudflareRequest(`/accounts/${encodeURIComponent(accountId)}/slurper/jobs`, {
      query: { limit: 100, offset: 0 },
    })
    const jobs = Array.isArray(result) ? result : (result?.jobs || result?.items || [])
    const sourceBuckets = new Set([buckets.gcsPublic, buckets.gcsPrivate])
    const targetBuckets = new Set([buckets.r2Public, buckets.r2Private])
    const active = jobs.filter((job) => {
      const status = String(job?.status || '').toLowerCase()
      const source = String(job?.source?.bucket || '')
      const target = String(job?.target?.bucket || '')
      return sourceBuckets.has(source) && targetBuckets.has(target) && ['running', 'paused', 'pending', 'queued'].includes(status)
    })
    pushCheck(
      'no_active_super_slurper_jobs',
      active.length === 0,
      active.length ? active.map((job) => ({ id: job?.id || null, status: job?.status || null })) : null,
    )
  } catch (error) {
    pushCheck('no_active_super_slurper_jobs', false, redactError(error))
  }
} catch (error) {
  pushCheck('cloudflare_cutover_checks', false, redactError(error))
}

const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
const allDependencies = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) }
pushCheck(
  'google_cloud_storage_sdk_removed',
  !Object.prototype.hasOwnProperty.call(allDependencies, '@google-cloud/storage'),
  Object.prototype.hasOwnProperty.call(allDependencies, '@google-cloud/storage') ? 'Remove @google-cloud/storage before final cutover.' : null,
)

const runtimeEnvNames = [
  'GCP_PROJECT_ID',
  'GCP_BUCKET_NAME',
  'GCP_PRIVATE_BUCKET_NAME',
  'GCP_KEY_FILE',
  'GOOGLE_APPLICATION_CREDENTIALS',
]
const presentLegacyRuntimeEnv = runtimeEnvNames.filter((name) => String(process.env[name] || '').trim())
pushCheck(
  'legacy_gcs_runtime_credentials_removed',
  presentLegacyRuntimeEnv.length === 0,
  presentLegacyRuntimeEnv.length ? { present: presentLegacyRuntimeEnv } : null,
)

const failures = checks.filter((entry) => !entry.ok)
const output = {
  generatedAt: new Date().toISOString(),
  verificationReport: reportPath,
  migrationMode: String(process.env.OBJECT_STORAGE_MIGRATION_MODE || 'off').trim().toLowerCase(),
  bucketMappings: requiredBucketPairs.map(([scope, sourceBucket, destinationBucket]) => ({ scope, sourceBucket, destinationBucket })),
  databaseScan: dbScan ? {
    documentsScanned: dbScan.documentsScanned,
    referencesFound: dbScan.referencesFound,
    truncated: dbScan.truncated,
  } : null,
  checks,
  cutoverFinalized: failures.length === 0,
  failures: failures.map((entry) => entry.name),
}
writeJson(outputPath, output)
console.log(JSON.stringify({ output: outputPath, cutoverFinalized: output.cutoverFinalized, failures: output.failures }, null, 2))
if (failures.length) process.exitCode = 2
