#!/usr/bin/env node
import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3'
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

const accountId = String(process.env.R2_ACCOUNT_ID || '').trim()
const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim()
const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim()
const publicBucket = String(process.env.R2_PUBLIC_BUCKET_NAME || '').trim()
const privateBucket = String(process.env.R2_PRIVATE_BUCKET_NAME || '').trim()
const endpoint = String(process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '')).trim()
const browserOrigin = String(process.env.OBJECT_STORAGE_BROWSER_ORIGIN || 'https://realestate.opygen.com').replace(/\/+$/, '')

const fail = (message) => { console.error(`[r2-cors] ${message}`); process.exit(1) }
if (!accountId) fail('R2_ACCOUNT_ID is required')
if (!accessKeyId) fail('R2_ACCESS_KEY_ID is required')
if (!secretAccessKey) fail('R2_SECRET_ACCESS_KEY is required')
if (!publicBucket) fail('R2_PUBLIC_BUCKET_NAME is required')
if (!privateBucket) fail('R2_PRIVATE_BUCKET_NAME is required')
if (publicBucket === privateBucket) fail('R2 public and private buckets must be different')
if (!/^https:\/\//i.test(endpoint)) fail('R2_ENDPOINT must use https://')
if (!/^https?:\/\//i.test(browserOrigin)) fail('OBJECT_STORAGE_BROWSER_ORIGIN must be an http(s) origin')

const client = new S3Client({
  region: 'auto',
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
  maxAttempts: 3,
})

const rules = [{
  AllowedOrigins: [browserOrigin],
  AllowedMethods: ['GET', 'HEAD', 'PUT'],
  AllowedHeaders: ['Content-Type'],
  ExposeHeaders: ['ETag'],
  MaxAgeSeconds: 3600,
}]

for (const bucket of [publicBucket, privateBucket]) {
  console.log(`[r2-cors] applying strict browser CORS to ${bucket}`)
  await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: rules } }))
  const result = await client.send(new GetBucketCorsCommand({ Bucket: bucket }))
  console.log(JSON.stringify({ bucket, origin: browserOrigin, rules: result.CORSRules || [] }, null, 2))
}
