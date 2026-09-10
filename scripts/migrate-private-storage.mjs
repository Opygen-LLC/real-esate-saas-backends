#!/usr/bin/env node
import { Storage } from '@google-cloud/storage'
import fs from 'node:fs'
import path from 'node:path'

const arg = (name) => {
  const prefix = `--${name}=`
  const value = process.argv.find((entry) => entry.startsWith(prefix))
  return value ? value.slice(prefix.length) : ''
}
const applying = process.argv.includes('--apply')
const tenant = arg('tenant').trim()
const limit = Math.max(1, Math.min(100000, Number(arg('limit') || 100000)))
const concurrency = Math.max(1, Math.min(20, Number(arg('concurrency') || 5)))
const projectId = String(process.env.GCP_PROJECT_ID || '').trim()
const publicBucketName = String(process.env.GCP_BUCKET_NAME || '').trim()
const privateBucketName = String(process.env.GCP_PRIVATE_BUCKET_NAME || '').trim()
const keyFilenameRaw = String(process.env.GCP_KEY_FILE || '').trim()

const fail = (message) => { console.error(`[private-storage-migration] ${message}`); process.exit(1) }
if (!projectId) fail('GCP_PROJECT_ID is required')
if (!publicBucketName) fail('GCP_BUCKET_NAME is required')
if (!privateBucketName) fail('GCP_PRIVATE_BUCKET_NAME is required')
if (publicBucketName === privateBucketName) fail('Public and private buckets must be different')
if (applying && process.env.MIGRATE_PRIVATE_STORAGE_CONFIRM !== 'copy-and-delete-public-private-objects') {
  fail('Set MIGRATE_PRIVATE_STORAGE_CONFIRM=copy-and-delete-public-private-objects before using --apply')
}

const options = { projectId }
if (keyFilenameRaw) {
  const resolved = path.resolve(process.cwd(), keyFilenameRaw)
  if (!fs.existsSync(resolved)) fail(`GCP_KEY_FILE does not exist: ${resolved}`)
  options.keyFilename = resolved
}
const storage = new Storage(options)
const publicBucket = storage.bucket(publicBucketName)
const privateBucket = storage.bucket(privateBucketName)
const publicPrincipals = new Set(['allUsers', 'allAuthenticatedUsers'])

const [privateExists] = await privateBucket.exists()
if (!privateExists) fail(`Private bucket does not exist: ${privateBucketName}`)
const [privatePolicy] = await privateBucket.iam.getPolicy()
const unsafeBinding = (privatePolicy.bindings || []).find((binding) =>
  (binding.members || []).some((member) => publicPrincipals.has(member))
)
if (unsafeBinding) fail(`Private bucket has public IAM binding ${unsafeBinding.role}; remove it before migration`)

const isPrivateObject = (name) => /^support\//.test(name)
  || /^tenants\/[^/]+\/properties\/documents\//.test(name)
  || /^tenants\/[^/]+\/suppliers\/invoices\//.test(name)

const prefixes = tenant
  ? [`support/${tenant}/`, `tenants/${tenant}/`]
  : ['support/', 'tenants/']

const objects = []
for (const prefix of prefixes) {
  let pageToken
  do {
    const [files, , apiResponse] = await publicBucket.getFiles({ prefix, autoPaginate: false, maxResults: 1000, pageToken })
    for (const file of files) {
      if (isPrivateObject(file.name)) objects.push(file.name)
      if (objects.length >= limit) break
    }
    pageToken = apiResponse?.nextPageToken
  } while (pageToken && objects.length < limit)
  if (objects.length >= limit) break
}

console.log(JSON.stringify({
  mode: applying ? 'apply' : 'dry-run',
  publicBucket: publicBucketName,
  privateBucket: privateBucketName,
  tenant: tenant || 'all',
  objectsFound: objects.length,
  limit,
}, null, 2))
if (!applying) {
  console.log('Dry run only. Re-run with --apply and the explicit confirmation environment variable to migrate.')
  process.exit(0)
}

let copied = 0
let deleted = 0
let skipped = 0
let failed = 0
let cursor = 0
const worker = async () => {
  while (true) {
    const index = cursor++
    if (index >= objects.length) return
    const name = objects[index]
    const source = publicBucket.file(name)
    const destination = privateBucket.file(name)
    try {
      const [sourceMeta] = await source.getMetadata()
      const [destinationExists] = await destination.exists()
      if (!destinationExists) {
        await source.copy(destination)
        copied += 1
      } else {
        skipped += 1
      }
      const [destinationMeta] = await destination.getMetadata()
      const sourceSize = Number(sourceMeta.size || 0)
      const destinationSize = Number(destinationMeta.size || 0)
      const checksumMatches = !sourceMeta.crc32c || !destinationMeta.crc32c || sourceMeta.crc32c === destinationMeta.crc32c
      if (sourceSize !== destinationSize || !checksumMatches) throw new Error('destination verification failed')
      await source.delete({ ignoreNotFound: true })
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
