#!/usr/bin/env node
import { GetBucketCorsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(here, '..', '.env')
if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line || !line.includes('=')) continue
    const index = line.indexOf('=')
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

const fail = (message) => {
  console.error(`[r2-browser-upload] ${message}`)
  process.exit(1)
}

const accountId = String(process.env.R2_ACCOUNT_ID || '').trim()
const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim()
const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim()
const publicBucket = String(process.env.R2_PUBLIC_BUCKET_NAME || '').trim()
const privateBucket = String(process.env.R2_PRIVATE_BUCKET_NAME || '').trim()
const endpoint = String(process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '')).trim()
const origin = String(process.env.OBJECT_STORAGE_BROWSER_ORIGIN || 'https://realestate.opygen.com').replace(/\/+$/, '')

if (!accountId) fail('R2_ACCOUNT_ID is required')
if (!accessKeyId) fail('R2_ACCESS_KEY_ID is required')
if (!secretAccessKey) fail('R2_SECRET_ACCESS_KEY is required')
if (!publicBucket) fail('R2_PUBLIC_BUCKET_NAME is required')
if (!privateBucket) fail('R2_PRIVATE_BUCKET_NAME is required')
if (!/^https:\/\//i.test(endpoint)) fail('R2_ENDPOINT must use https://')
if (!/^https?:\/\//i.test(origin)) fail('OBJECT_STORAGE_BROWSER_ORIGIN must be an absolute http(s) origin')

const client = new S3Client({
  region: 'auto',
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  maxAttempts: 3,
})

const lower = (values = []) => values.map((value) => String(value).toLowerCase())
const corsAllowsBrowserPut = (rules = []) => rules.some((rule) => {
  const origins = new Set(lower(rule.AllowedOrigins))
  const methods = new Set(lower(rule.AllowedMethods))
  const headers = new Set(lower(rule.AllowedHeaders))
  return origins.has(origin.toLowerCase()) && methods.has('put') && methods.has('head') && headers.has('content-type')
})

for (const bucket of [publicBucket, privateBucket]) {
  const cors = await client.send(new GetBucketCorsCommand({ Bucket: bucket }))
  if (!corsAllowsBrowserPut(cors.CORSRules || [])) {
    fail(`${bucket} does not allow browser PUT/HEAD from ${origin} with Content-Type. Run: pnpm storage:r2:cors`)
  }
}

const probeKey = `__browser-upload-probe/${Date.now()}-image.png`
const signedUrl = await getSignedUrl(
  client,
  new PutObjectCommand({
    Bucket: privateBucket,
    Key: probeKey,
    ContentType: 'image/png',
  }),
  {
    expiresIn: 120,
    signableHeaders: new Set(['content-type']),
  },
)

const parsed = new URL(signedUrl)
const forbiddenChecksumParams = [
  'x-amz-checksum-crc32',
  'x-amz-sdk-checksum-algorithm',
].filter((name) => parsed.searchParams.has(name))
if (forbiddenChecksumParams.length) {
  fail(`presigned PUT still contains automatic checksum parameters: ${forbiddenChecksumParams.join(', ')}`)
}

const signedHeaders = decodeURIComponent(parsed.searchParams.get('X-Amz-SignedHeaders') || parsed.searchParams.get('x-amz-signedheaders') || '')
  .toLowerCase()
  .split(';')
  .filter(Boolean)
if (!signedHeaders.includes('host') || !signedHeaders.includes('content-type')) {
  fail(`presigned PUT must sign host and content-type; received: ${signedHeaders.join(', ') || '(none)'}`)
}

console.log(JSON.stringify({
  ok: true,
  provider: 'cloudflare-r2',
  endpoint: parsed.origin,
  publicBucket,
  privateBucket,
  browserOrigin: origin,
  signedHeaders,
  automaticPayloadChecksum: false,
  corsVerified: true,
}, null, 2))
