#!/usr/bin/env node
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'

const arg = (name) => {
  const prefix = `--${name}=`
  const value = process.argv.find((entry) => entry.startsWith(prefix))
  return value ? value.slice(prefix.length) : ''
}
const applying = process.argv.includes('--apply')
const tenant = arg('tenant').trim()
const limit = Math.max(1, Math.min(100000, Number(arg('limit') || 100000)))
const concurrency = Math.max(1, Math.min(20, Number(arg('concurrency') || 5)))
const accountId = String(process.env.R2_ACCOUNT_ID || '').trim()
const endpoint = String(process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '')).trim()
const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim()
const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim()
const publicBucketName = String(process.env.R2_PUBLIC_BUCKET_NAME || '').trim()
const privateBucketName = String(process.env.R2_PRIVATE_BUCKET_NAME || '').trim()

const fail = (message) => { console.error(`[private-storage-migration] ${message}`); process.exit(1) }
if (!endpoint) fail('R2_ENDPOINT or R2_ACCOUNT_ID is required')
if (!accessKeyId) fail('R2_ACCESS_KEY_ID is required')
if (!secretAccessKey) fail('R2_SECRET_ACCESS_KEY is required')
if (!publicBucketName) fail('R2_PUBLIC_BUCKET_NAME is required')
if (!privateBucketName) fail('R2_PRIVATE_BUCKET_NAME is required')
if (publicBucketName === privateBucketName) fail('Public and private R2 buckets must be different')
if (applying && process.env.MIGRATE_PRIVATE_STORAGE_CONFIRM !== 'copy-and-delete-public-private-objects') {
  fail('Set MIGRATE_PRIVATE_STORAGE_CONFIRM=copy-and-delete-public-private-objects before using --apply')
}

const storage = new S3Client({
  region: 'auto', endpoint, forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey }, maxAttempts: 3,
})
await Promise.all([
  storage.send(new HeadBucketCommand({ Bucket: publicBucketName })),
  storage.send(new HeadBucketCommand({ Bucket: privateBucketName })),
])

const isPrivateObject = (name) => /^support\//.test(name)
  || /^tenants\/[^/]+\/properties\/documents\//.test(name)
  || /^tenants\/[^/]+\/suppliers\/invoices\//.test(name)

const prefixes = tenant ? [`support/${tenant}/`, `tenants/${tenant}/`] : ['support/', 'tenants/']
const objects = []
for (const prefix of prefixes) {
  let continuationToken
  do {
    const page = await storage.send(new ListObjectsV2Command({
      Bucket: publicBucketName, Prefix: prefix, MaxKeys: Math.min(1000, limit - objects.length),
      ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
    }))
    for (const object of page.Contents || []) {
      if (object.Key && isPrivateObject(object.Key)) objects.push(object.Key)
      if (objects.length >= limit) break
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (continuationToken && objects.length < limit)
  if (objects.length >= limit) break
}

console.log(JSON.stringify({
  provider: 'r2', mode: applying ? 'apply' : 'dry-run', publicBucket: publicBucketName,
  privateBucket: privateBucketName, tenant: tenant || 'all', objectsFound: objects.length, limit,
}, null, 2))
if (!applying) {
  console.log('Dry run only. Re-run with --apply and the explicit confirmation environment variable to migrate.')
  process.exit(0)
}

const copySource = (bucket, key) => encodeURIComponent(`${bucket}/${key}`).replace(/%2F/gi, '/')
let copied = 0
let deleted = 0
let skipped = 0
let failed = 0
let cursor = 0
const worker = async () => {
  while (true) {
    const index = cursor++
    if (index >= objects.length) return
    const key = objects[index]
    try {
      const source = await storage.send(new HeadObjectCommand({ Bucket: publicBucketName, Key: key }))
      let destination
      try {
        destination = await storage.send(new HeadObjectCommand({ Bucket: privateBucketName, Key: key }))
        skipped += 1
      } catch (error) {
        if (Number(error?.$metadata?.httpStatusCode) !== 404 && !['NotFound', 'NoSuchKey'].includes(String(error?.name || ''))) throw error
        await storage.send(new CopyObjectCommand({
          Bucket: privateBucketName,
          Key: key,
          CopySource: copySource(publicBucketName, key),
          ...(source.ContentType ? { ContentType: source.ContentType, MetadataDirective: 'REPLACE' } : {}),
        }))
        destination = await storage.send(new HeadObjectCommand({ Bucket: privateBucketName, Key: key }))
        copied += 1
      }
      if (Number(source.ContentLength || 0) !== Number(destination.ContentLength || 0)) throw new Error('destination size verification failed')
      await storage.send(new DeleteObjectCommand({ Bucket: publicBucketName, Key: key }))
      deleted += 1
    } catch (error) {
      failed += 1
      console.error(`[private-storage-migration] failed object ${index + 1}/${objects.length}: ${String(error?.message || error).slice(0, 240)}`)
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()))
console.log(JSON.stringify({ migrated: objects.length - failed, copied, existingDestination: skipped, deletedFromPublic: deleted, failed }, null, 2))
if (failed) process.exitCode = 1
