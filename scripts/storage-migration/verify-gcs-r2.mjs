#!/usr/bin/env node
import crypto from 'node:crypto'
import path from 'node:path'
import sharp from 'sharp'
import {
  arg,
  canonicalR2PublicUrl,
  fail,
  hasFlag,
  intArg,
  isPrivateObjectKey,
  loadGcsServiceAccount,
  mapWithConcurrency,
  parseGcsReference,
  redactError,
  requireMigrationBuckets,
  timestampSlug,
  writeJson,
} from './lib/common.mjs'
import { downloadGcsObject, listGcsObjects } from './lib/gcs.mjs'
import { closeMigrationDatabase, scanGcsReferences } from './lib/mongo-references.mjs'
import {
  assertR2Bucket,
  createR2ClientFromEnv,
  downloadR2Object,
  headR2Object,
  listR2Objects,
  presignR2Get,
} from './lib/r2.mjs'

const buckets = requireMigrationBuckets()
const credentials = loadGcsServiceAccount()
const r2 = createR2ClientFromEnv()
const tenant = arg('tenant').trim()
const explicitPrefix = arg('prefix').trim().replace(/^\/+/, '')
const prefix = explicitPrefix || (tenant ? `tenants/${tenant}/` : '')
const concurrency = intArg('concurrency', 8, 1, 20)
const checksumSample = intArg('checksum-sample', 25, 0, 500)
const httpSample = intArg('http-sample', 10, 0, 100)
const maxDownloadBytes = intArg('max-download-bytes', 32 * 1024 * 1024, 1024, 256 * 1024 * 1024)
const allowLegacyRefs = hasFlag('allow-legacy-refs')
const skipDb = hasFlag('skip-db')
const skipHttp = hasFlag('skip-http')
const outputPath = path.resolve(arg('output', `migration-reports/gcs-r2-verification-${timestampSlug()}.json`))

await Promise.all([
  assertR2Bucket(r2, buckets.r2Public),
  assertR2Bucket(r2, buckets.r2Private),
])

const source = []
const loadSource = async (bucket, destinationBucket, visibility) => {
  for await (const object of listGcsObjects(credentials, bucket, { prefix })) {
    source.push({ ...object, bucket, destinationBucket, visibility })
  }
}
await loadSource(buckets.gcsPublic, buckets.r2Public, 'public')
if (buckets.gcsPrivate !== buckets.gcsPublic) await loadSource(buckets.gcsPrivate, buckets.r2Private, 'private')
source.sort((a, b) => a.bucket.localeCompare(b.bucket) || a.key.localeCompare(b.key))

const destinationMaps = new Map()
for (const [visibility, bucket] of [['public', buckets.r2Public], ['private', buckets.r2Private]]) {
  const map = new Map()
  for await (const object of listR2Objects(r2, bucket, { prefix })) map.set(object.key, object)
  destinationMaps.set(visibility, map)
}

const mismatches = []
const routingMismatches = source.filter((object) => object.visibility !== (isPrivateObjectKey(object.key) ? 'private' : 'public'))
for (const object of routingMismatches.slice(0, 200)) {
  mismatches.push({ bucket: object.bucket, key: object.key, issue: 'application_bucket_routing_mismatch', sourceVisibility: object.visibility })
}
let missingObjects = 0
let sizeMismatches = 0
let contentTypeMismatches = 0
let verifiedMetadata = 0

await mapWithConcurrency(source, concurrency, async (object) => {
  const listed = destinationMaps.get(object.visibility)?.get(object.key)
  if (!listed) {
    missingObjects += 1
    if (mismatches.length < 200) mismatches.push({ bucket: object.bucket, key: object.key, issue: 'missing_in_r2' })
    return
  }
  if (Number(listed.size) !== Number(object.size)) {
    sizeMismatches += 1
    if (mismatches.length < 200) mismatches.push({ bucket: object.bucket, key: object.key, issue: 'size_mismatch', gcs: object.size, r2: listed.size })
    return
  }
  try {
    const head = await headR2Object(r2, object.destinationBucket, object.key)
    verifiedMetadata += 1
    const sourceType = String(object.contentType || 'application/octet-stream').toLowerCase()
    const targetType = String(head.contentType || 'application/octet-stream').toLowerCase()
    if (sourceType !== targetType) {
      contentTypeMismatches += 1
      if (mismatches.length < 200) mismatches.push({ bucket: object.bucket, key: object.key, issue: 'content_type_mismatch', gcs: sourceType, r2: targetType })
    }
  } catch (error) {
    missingObjects += 1
    if (mismatches.length < 200) mismatches.push({ bucket: object.bucket, key: object.key, issue: 'r2_head_failed', detail: redactError(error) })
  }
})

const deterministicSample = (items, count) => {
  if (!count || !items.length) return []
  if (count >= items.length) return items
  const chosen = []
  const step = items.length / count
  for (let index = 0; index < count; index += 1) chosen.push(items[Math.floor(index * step)])
  return chosen
}

let checksumCompared = 0
let checksumMismatches = 0
let imagesDecoded = 0
let imageDecodeFailures = 0
const checksumFailures = []

const checksumCandidates = deterministicSample(
  source.filter((object) => object.size <= maxDownloadBytes && destinationMaps.get(object.visibility)?.has(object.key)),
  checksumSample,
)
await mapWithConcurrency(checksumCandidates, Math.min(concurrency, 4), async (object) => {
  try {
    const [gcsBody, r2Body] = await Promise.all([
      downloadGcsObject(credentials, object.bucket, object.key, maxDownloadBytes),
      downloadR2Object(r2, object.destinationBucket, object.key, maxDownloadBytes),
    ])
    const gcsHash = crypto.createHash('sha256').update(gcsBody).digest('hex')
    const r2Hash = crypto.createHash('sha256').update(r2Body).digest('hex')
    checksumCompared += 1
    if (gcsHash !== r2Hash) {
      checksumMismatches += 1
      if (checksumFailures.length < 100) checksumFailures.push({ bucket: object.bucket, key: object.key, issue: 'sha256_mismatch' })
      return
    }
    if (String(object.contentType).toLowerCase().startsWith('image/')) {
      try {
        const metadata = await sharp(r2Body, { failOn: 'error', limitInputPixels: 80_000_000 }).metadata()
        if (!metadata.width || !metadata.height) throw new Error('missing_image_dimensions')
        imagesDecoded += 1
      } catch (error) {
        imageDecodeFailures += 1
        if (checksumFailures.length < 100) checksumFailures.push({ bucket: object.bucket, key: object.key, issue: 'image_decode_failed', detail: redactError(error) })
      }
    }
  } catch (error) {
    checksumMismatches += 1
    if (checksumFailures.length < 100) checksumFailures.push({ bucket: object.bucket, key: object.key, issue: 'sample_download_failed', detail: redactError(error) })
  }
})

let legacyReferences = null
let databaseScan = null
if (!skipDb) {
  try {
    const result = await scanGcsReferences({
      gcsBuckets: [buckets.gcsPublic, buckets.gcsPrivate],
      onReference: () => undefined,
    })
    legacyReferences = result.referencesFound
    databaseScan = result
  } finally {
    await closeMigrationDatabase()
  }
}

const httpChecks = []
if (!skipHttp && httpSample > 0) {
  const publicSample = deterministicSample(source.filter((object) => object.visibility === 'public'), httpSample)
  for (const object of publicSample) {
    const url = canonicalR2PublicUrl(object.key)
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { range: 'bytes=0-0' },
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      })
      httpChecks.push({ key: object.key, visibility: 'public', ok: response.ok || response.status === 206, status: response.status })
      await response.body?.cancel().catch(() => undefined)
    } catch (error) {
      httpChecks.push({ key: object.key, visibility: 'public', ok: false, status: 0, detail: redactError(error) })
    }
  }

  const privateSample = deterministicSample(source.filter((object) => object.visibility === 'private'), Math.min(httpSample, 5))
  const endpoint = String(process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/+$/, '')
  for (const object of privateSample) {
    try {
      const unsignedUrl = `${endpoint}/${encodeURIComponent(buckets.r2Private)}/${object.key.split('/').map(encodeURIComponent).join('/')}`
      const unsigned = await fetch(unsignedUrl, { method: 'GET', headers: { range: 'bytes=0-0' }, signal: AbortSignal.timeout(10_000) })
      await unsigned.body?.cancel().catch(() => undefined)
      const privateBlocked = [401, 403, 404].includes(unsigned.status)
      const signedUrl = await presignR2Get(r2, buckets.r2Private, object.key, 120)
      const signed = await fetch(signedUrl, { method: 'GET', headers: { range: 'bytes=0-0' }, signal: AbortSignal.timeout(15_000) })
      await signed.body?.cancel().catch(() => undefined)
      httpChecks.push({ key: object.key, visibility: 'private', ok: privateBlocked && (signed.ok || signed.status === 206), unsignedStatus: unsigned.status, signedStatus: signed.status })
    } catch (error) {
      httpChecks.push({ key: object.key, visibility: 'private', ok: false, detail: redactError(error) })
    }
  }
}

const destinationPublicCount = destinationMaps.get('public')?.size || 0
const destinationPrivateCount = destinationMaps.get('private')?.size || 0
const httpFailures = httpChecks.filter((item) => !item.ok).length
const objectVerificationPassed = routingMismatches.length === 0
  && missingObjects === 0
  && sizeMismatches === 0
  && contentTypeMismatches === 0
  && checksumMismatches === 0
  && imageDecodeFailures === 0
  && httpFailures === 0
const referenceVerificationPassed = skipDb ? null : legacyReferences === 0
const cutoverReady = objectVerificationPassed && (allowLegacyRefs || skipDb || legacyReferences === 0)

const report = {
  generatedAt: new Date().toISOString(),
  source: 'gcs',
  destination: 'r2',
  bucketMappings: [
    { scope: 'public', sourceBucket: buckets.gcsPublic, destinationBucket: buckets.r2Public },
    { scope: 'private', sourceBucket: buckets.gcsPrivate, destinationBucket: buckets.r2Private },
  ],
  prefix: prefix || null,
  tenant: tenant || null,
  sourceObjects: source.length,
  sourceBytes: source.reduce((total, item) => total + item.size, 0),
  destinationObjectsWithinPrefix: {
    public: destinationPublicCount,
    private: destinationPrivateCount,
  },
  metadata: {
    verified: verifiedMetadata,
    routingMismatches: routingMismatches.length,
    missingObjects,
    sizeMismatches,
    contentTypeMismatches,
  },
  checksum: {
    requestedSample: checksumSample,
    compared: checksumCompared,
    mismatches: checksumMismatches,
    imagesDecoded,
    imageDecodeFailures,
    failures: checksumFailures,
  },
  database: skipDb ? { skipped: true } : {
    skipped: false,
    legacyReferences,
    scan: databaseScan,
  },
  http: {
    skipped: skipHttp,
    checks: httpChecks.length,
    failures: httpFailures,
    results: httpChecks,
  },
  mismatches,
  objectVerificationPassed,
  referenceVerificationPassed,
  cutoverReady,
  note: 'R2 and GCS ETags are intentionally not compared. Content verification uses size/content-type plus sampled SHA-256 and image decode checks.',
}
writeJson(outputPath, report)
console.log(JSON.stringify({ ...report, outputPath }, null, 2))
if (!cutoverReady) process.exitCode = 1
