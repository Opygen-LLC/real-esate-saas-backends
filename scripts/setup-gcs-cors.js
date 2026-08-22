#!/usr/bin/env node
/**
 * setup-gcs-cors.js
 *
 * Run once to configure CORS on your GCS bucket so browsers can upload
 * property photos and website media directly to GCS via signed URLs.
 *
 * Usage:
 *   GCP_KEY_FILE=opy-realestate-505614-d4e3b5e9f13d.json \
 *   GCP_BUCKET_NAME=realestate-saas \
 *   CLIENT_URL=http://34.131.86.177 \
 *   node scripts/setup-gcs-cors.js
 *
 * Or just: node scripts/setup-gcs-cors.js  (reads from .env in project root)
 */

const path = require('path')
const fs = require('fs')

// Load .env if present
const envPath = path.resolve(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
    const [key, ...rest] = line.replace(/#.*$/, '').trim().split('=')
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim()
  })
}

const { Storage } = require('@google-cloud/storage')

const projectId = process.env.GCP_PROJECT_ID || process.env.PROJECTS_ID
const keyFileRaw = process.env.GCP_KEY_FILE || process.env.KEYFILENAME || ''
const bucketName = process.env.GCP_BUCKET_NAME || process.env.BUCKET_NAME
const clientUrl = process.env.CLIENT_URL || process.env.OBJECT_STORAGE_BROWSER_ORIGIN || 'http://localhost:3000'

if (!bucketName) { console.error('GCP_BUCKET_NAME is required'); process.exit(1) }

const opts = {}
if (projectId) opts.projectId = projectId
if (keyFileRaw) {
  const resolved = path.resolve(process.cwd(), keyFileRaw)
  const parent = path.resolve(process.cwd(), '..', keyFileRaw)
  if (fs.existsSync(resolved)) opts.keyFilename = resolved
  else if (fs.existsSync(parent)) opts.keyFilename = parent
}

const storage = new Storage(opts)

const corsConfig = [
  {
    maxAgeSeconds: 3600,
    method: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
    origin: ['*', clientUrl].filter(Boolean),
    responseHeader: ['Content-Type', 'Authorization', 'x-goog-meta-*'],
  },
]

async function main() {
  console.log(`Setting CORS on bucket: ${bucketName}`)
  console.log(`Allowing origin: ${clientUrl}`)
  await storage.bucket(bucketName).setCorsConfiguration(corsConfig)
  const [meta] = await storage.bucket(bucketName).getMetadata()
  console.log('CORS configured successfully:')
  console.log(JSON.stringify(meta.cors, null, 2))

  // Also ensure the bucket is set to uniform bucket-level access with public read
  // (so files served via storage.googleapis.com are publicly accessible)
  try {
    await storage.bucket(bucketName).makePublic()
    console.log('Bucket set to public read access for served files.')
  } catch (err) {
    console.warn('Could not set bucket to public (may already be set or requires IAM permission):', err.message)
  }
}

main().catch((err) => { console.error('Error:', err.message); process.exit(1) })
