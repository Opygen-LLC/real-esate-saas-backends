#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import {
  arg,
  ensureDirectory,
  fail,
  hasFlag,
  intArg,
  isPrivateObjectKey,
  loadGcsServiceAccount,
  requireMigrationBuckets,
  tenantFromKey,
  timestampSlug,
  writeJson,
} from './lib/common.mjs'
import { listGcsObjects } from './lib/gcs.mjs'
import { closeMigrationDatabase, scanGcsReferences } from './lib/mongo-references.mjs'

const credentials = loadGcsServiceAccount()
const buckets = requireMigrationBuckets()
const tenant = arg('tenant').trim()
const explicitPrefix = arg('prefix').trim().replace(/^\/+/, '')
const prefix = explicitPrefix || (tenant ? `tenants/${tenant}/` : '')
const skipDb = hasFlag('skip-db')
const maxDocuments = intArg('max-db-documents', 0, 0, 50_000_000)
const maxRefsPerObject = intArg('max-refs-per-object', 25, 1, 500)
const outputDirectory = ensureDirectory(path.resolve(arg('output-dir', 'migration-reports')))
const slug = timestampSlug()
const manifestPath = path.join(outputDirectory, `gcs-inventory-${slug}.jsonl`)
const summaryPath = path.join(outputDirectory, `gcs-inventory-${slug}.summary.json`)

const records = []
const recordsByBucketAndKey = new Map()
const recordsByKey = new Map()

const addRecord = (bucket, destinationBucket, visibility, object) => {
  const record = {
    key: object.key,
    bucket,
    destinationBucket,
    size: object.size,
    contentType: object.contentType,
    updatedAt: object.updatedAt,
    visibility,
    tenant: tenantFromKey(object.key),
    md5Hash: object.md5Hash || null,
    crc32c: object.crc32c || null,
    generation: object.generation || null,
    keyRoutingMatchesVisibility: visibility === (isPrivateObjectKey(object.key) ? 'private' : 'public'),
    databaseReferences: [],
    databaseReferenceCount: 0,
  }
  records.push(record)
  recordsByBucketAndKey.set(`${bucket}\u0000${object.key}`, record)
  const sameKey = recordsByKey.get(object.key) || []
  sameKey.push(record)
  recordsByKey.set(object.key, sameKey)
}

const listBucket = async (sourceBucket, destinationBucket, visibility) => {
  for await (const object of listGcsObjects(credentials, sourceBucket, { prefix })) {
    addRecord(sourceBucket, destinationBucket, visibility, object)
  }
}

console.error(`[storage-migration] Inventorying GCS objects${prefix ? ` below ${prefix}` : ''}...`)
await listBucket(buckets.gcsPublic, buckets.r2Public, 'public')
if (buckets.gcsPrivate !== buckets.gcsPublic) {
  await listBucket(buckets.gcsPrivate, buckets.r2Private, 'private')
}

let databaseScan = { skipped: true, documentsScanned: 0, referencesFound: 0, truncated: false }
if (!skipDb) {
  const knownKeys = new Set(records.map((record) => record.key))
  console.error('[storage-migration] Scanning MongoDB for storage references...')
  try {
    const result = await scanGcsReferences({
      gcsBuckets: [buckets.gcsPublic, buckets.gcsPrivate],
      knownKeys,
      maxDocuments,
      onReference: ({ collection, documentId, path: referencePath, value, bucket, key }) => {
        let record = bucket ? recordsByBucketAndKey.get(`${bucket}\u0000${key}`) : null
        if (!record) {
          const candidates = recordsByKey.get(key) || []
          record = candidates.find((candidate) => candidate.visibility === (isPrivateObjectKey(key) ? 'private' : 'public')) || candidates[0]
        }
        if (!record) return
        record.databaseReferenceCount += 1
        if (record.databaseReferences.length < maxRefsPerObject) {
          record.databaseReferences.push({ collection, documentId, path: referencePath, value })
        }
      },
    })
    databaseScan = { skipped: false, ...result }
  } finally {
    await closeMigrationDatabase()
  }
}

records.sort((a, b) => a.bucket.localeCompare(b.bucket) || a.key.localeCompare(b.key))
fs.writeFileSync(manifestPath, '', { mode: 0o600 })
for (const record of records) fs.appendFileSync(manifestPath, `${JSON.stringify(record)}\n`)

const publicObjects = records.filter((record) => record.visibility === 'public')
const privateObjects = records.filter((record) => record.visibility === 'private')
const referencedObjects = skipDb ? [] : records.filter((record) => record.databaseReferenceCount > 0)
const orphanCandidates = skipDb ? [] : records.filter((record) => record.databaseReferenceCount === 0)
const summary = {
  generatedAt: new Date().toISOString(),
  source: 'gcs',
  destination: 'r2',
  prefix: prefix || null,
  tenant: tenant || null,
  manifestPath,
  objectCount: records.length,
  totalBytes: records.reduce((total, record) => total + record.size, 0),
  publicObjects: publicObjects.length,
  publicBytes: publicObjects.reduce((total, record) => total + record.size, 0),
  privateObjects: privateObjects.length,
  privateBytes: privateObjects.reduce((total, record) => total + record.size, 0),
  routingMismatches: records.filter((record) => !record.keyRoutingMatchesVisibility).length,
  referencedObjects: skipDb ? null : referencedObjects.length,
  orphanCandidates: skipDb ? null : orphanCandidates.length,
  databaseScan,
  buckets: {
    gcsPublic: buckets.gcsPublic,
    gcsPrivate: buckets.gcsPrivate,
    r2Public: buckets.r2Public,
    r2Private: buckets.r2Private,
  },
  warning: skipDb
    ? 'Database reference scan was explicitly skipped; orphan counts are intentionally unavailable.'
    : databaseScan.truncated
      ? 'Database scan was truncated. Do not use orphanCandidates for deletion decisions.'
      : records.some((record) => !record.keyRoutingMatchesVisibility)
        ? 'One or more source-bucket visibilities disagree with application key routing. Resolve routingMismatches before cutover.'
        : 'orphanCandidates means no matching string reference was found in MongoDB; review manually before deletion.',
}
writeJson(summaryPath, summary)
console.log(JSON.stringify(summary, null, 2))
