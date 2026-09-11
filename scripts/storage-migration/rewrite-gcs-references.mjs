#!/usr/bin/env node
import path from 'node:path'
import {
  arg,
  canonicalR2PublicUrl,
  fail,
  hasFlag,
  intArg,
  parseGcsReference,
  redactError,
  requireMigrationBuckets,
  timestampSlug,
  writeJson,
} from './lib/common.mjs'
import { closeMigrationDatabase, connectMigrationDatabase, walkStrings } from './lib/mongo-references.mjs'
import { assertR2Bucket, createR2ClientFromEnv, headR2Object } from './lib/r2.mjs'

const applying = hasFlag('apply')
const rewritePrivate = hasFlag('rewrite-private-to-key')
const maxDocuments = intArg('max-documents', 0, 0, 50_000_000)
const outputPath = path.resolve(arg('output', `migration-reports/gcs-reference-rewrite-${timestampSlug()}.json`))
const buckets = requireMigrationBuckets()

if (applying && process.env.GCS_REFERENCE_REWRITE_CONFIRM !== 'rewrite-gcs-references-to-r2') {
  fail('Set GCS_REFERENCE_REWRITE_CONFIRM=rewrite-gcs-references-to-r2 before using --apply')
}
if (applying && rewritePrivate && process.env.GCS_PRIVATE_REFERENCE_REWRITE_CONFIRM !== 'private-gcs-urls-to-object-keys') {
  fail('Set GCS_PRIVATE_REFERENCE_REWRITE_CONFIRM=private-gcs-urls-to-object-keys before applying private URL rewrites')
}

const r2 = createR2ClientFromEnv()
await Promise.all([
  assertR2Bucket(r2, buckets.r2Public),
  assertR2Bucket(r2, buckets.r2Private),
])

const destinationExistsCache = new Map()
const destinationExists = async (bucket, key) => {
  const id = `${bucket}\u0000${key}`
  if (destinationExistsCache.has(id)) return destinationExistsCache.get(id)
  let exists = false
  try {
    await headR2Object(r2, bucket, key)
    exists = true
  } catch (error) {
    const status = Number(error?.$metadata?.httpStatusCode || error?.statusCode || 0)
    const name = String(error?.name || error?.Code || '')
    if (status !== 404 && !['NoSuchKey', 'NotFound'].includes(name)) throw error
  }
  destinationExistsCache.set(id, exists)
  return exists
}

const summary = {
  generatedAt: new Date().toISOString(),
  mode: applying ? 'apply' : 'dry-run',
  rewritePrivateToKey: rewritePrivate,
  documentsScanned: 0,
  documentsWithLegacyReferences: 0,
  legacyReferencesFound: 0,
  rewritableReferences: 0,
  modifiedDocuments: 0,
  conflicts: 0,
  missingR2Objects: 0,
  privateReferencesSkipped: 0,
  unsupportedLegacyReferences: 0,
  samples: [],
}

const db = await connectMigrationDatabase()
try {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray()
  outer: for (const { name } of collections) {
    if (!name || name.startsWith('system.')) continue
    const collection = db.collection(name)
    const cursor = collection.find({}, { batchSize: 100 })
    for await (const document of cursor) {
      summary.documentsScanned += 1
      const updates = {}
      const expected = {}
      let legacyInDocument = 0

      for (const entry of walkStrings(document)) {
        if (!entry.path) continue
        const parsed = parseGcsReference(entry.value)
        if (!parsed) continue
        if (![buckets.gcsPublic, buckets.gcsPrivate].includes(parsed.bucket)) continue

        summary.legacyReferencesFound += 1
        legacyInDocument += 1
        const sourceIsPrivate = parsed.bucket === buckets.gcsPrivate
        if (sourceIsPrivate && !rewritePrivate) {
          summary.privateReferencesSkipped += 1
          continue
        }
        if (!sourceIsPrivate && parsed.bucket !== buckets.gcsPublic) {
          summary.unsupportedLegacyReferences += 1
          continue
        }

        const destinationBucket = sourceIsPrivate ? buckets.r2Private : buckets.r2Public
        if (!(await destinationExists(destinationBucket, parsed.key))) {
          summary.missingR2Objects += 1
          if (summary.samples.length < 50) summary.samples.push({ collection: name, documentId: String(document._id), path: entry.path, key: parsed.key, issue: 'missing_r2_object' })
          continue
        }

        const replacement = sourceIsPrivate ? parsed.key : canonicalR2PublicUrl(parsed.key)
        if (replacement === entry.value) continue
        updates[entry.path] = replacement
        expected[entry.path] = entry.value
        summary.rewritableReferences += 1
        if (summary.samples.length < 50) {
          summary.samples.push({ collection: name, documentId: String(document._id), path: entry.path, key: parsed.key, replacement })
        }
      }

      if (legacyInDocument > 0) summary.documentsWithLegacyReferences += 1
      if (applying && Object.keys(updates).length) {
        const filter = { _id: document._id, ...expected }
        const result = await collection.updateOne(filter, { $set: updates })
        if (result.modifiedCount === 1) summary.modifiedDocuments += 1
        else summary.conflicts += 1
      }

      if (maxDocuments > 0 && summary.documentsScanned >= maxDocuments) {
        await cursor.close().catch(() => undefined)
        break outer
      }
    }
  }
} catch (error) {
  fail(`Reference rewrite failed: ${redactError(error)}`)
} finally {
  await closeMigrationDatabase()
}

summary.completedAt = new Date().toISOString()
summary.safeToDisableGcs = summary.missingR2Objects === 0
  && summary.conflicts === 0
  && summary.privateReferencesSkipped === 0
  && (applying ? summary.rewritableReferences === 0 || summary.modifiedDocuments > 0 : false)
writeJson(outputPath, summary)
console.log(JSON.stringify({ ...summary, outputPath }, null, 2))

if (applying && (summary.missingR2Objects > 0 || summary.conflicts > 0 || summary.privateReferencesSkipped > 0)) process.exitCode = 1
