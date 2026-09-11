import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { fail } from './common.mjs'

export const createR2ClientFromEnv = () => {
  const accountId = String(process.env.R2_ACCOUNT_ID || '').trim()
  const endpoint = String(process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '')).trim()
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim()
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim()
  if (!accountId) fail('R2_ACCOUNT_ID is required')
  if (!endpoint) fail('R2_ENDPOINT or R2_ACCOUNT_ID is required')
  if (!accessKeyId) fail('R2_ACCESS_KEY_ID is required')
  if (!secretAccessKey) fail('R2_SECRET_ACCESS_KEY is required')

  return new S3Client({
    region: 'auto',
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 3,
  })
}

export const assertR2Bucket = (client, bucket) => client.send(new HeadBucketCommand({ Bucket: bucket }))

export async function* listR2Objects(client, bucket, { prefix = '' } = {}) {
  let continuationToken
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || undefined,
      MaxKeys: 1000,
      ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
    }))
    for (const item of page.Contents || []) {
      if (!item.Key) continue
      yield {
        key: String(item.Key),
        size: Number(item.Size || 0),
        etag: String(item.ETag || '').replace(/"/g, ''),
        updatedAt: item.LastModified ? item.LastModified.toISOString() : null,
      }
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (continuationToken)
}

export const headR2Object = async (client, bucket, key) => {
  const item = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
  return {
    size: Number(item.ContentLength || 0),
    contentType: String(item.ContentType || 'application/octet-stream'),
    etag: String(item.ETag || '').replace(/"/g, ''),
    lastModified: item.LastModified ? item.LastModified.toISOString() : null,
  }
}

export const downloadR2Object = async (client, bucket, key, maxBytes = 32 * 1024 * 1024) => {
  const head = await headR2Object(client, bucket, key)
  if (head.size > maxBytes) throw new Error(`R2 object exceeds verification download limit (${head.size} > ${maxBytes})`)
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  if (!response.Body) throw new Error('R2 object response body is empty')
  const stream = response.Body
  const bytes = typeof stream.transformToByteArray === 'function'
    ? await stream.transformToByteArray()
    : Buffer.concat(await (async () => {
        const chunks = []
        for await (const chunk of stream) chunks.push(Buffer.from(chunk))
        return chunks
      })())
  const body = Buffer.from(bytes)
  if (body.length > maxBytes) throw new Error(`R2 object exceeds verification download limit (${body.length} > ${maxBytes})`)
  return body
}

export const presignR2Get = async (client, bucket, key, expiresIn = 120) => getSignedUrl(
  client,
  new GetObjectCommand({ Bucket: bucket, Key: key }),
  { expiresIn: Math.max(30, Math.min(300, Math.trunc(expiresIn))) },
)
