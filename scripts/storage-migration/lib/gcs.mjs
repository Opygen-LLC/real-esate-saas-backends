import crypto from 'node:crypto'
import { redactError } from './common.mjs'

const TOKEN_AUDIENCE = 'https://oauth2.googleapis.com/token'
const STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only'

const base64url = (value) => Buffer.from(value).toString('base64url')

let cachedToken = null

const createAssertion = ({ clientEmail, privateKey }) => {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = base64url(JSON.stringify({
    iss: clientEmail,
    scope: STORAGE_SCOPE,
    aud: TOKEN_AUDIENCE,
    iat: now,
    exp: now + 3600,
  }))
  const unsigned = `${header}.${claim}`
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')
  return `${unsigned}.${signature}`
}

export const getGcsAccessToken = async (credentials) => {
  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value

  const response = await fetch(TOKEN_AUDIENCE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: createAssertion(credentials),
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.access_token) {
    throw new Error(`GCS OAuth token request failed (${response.status}): ${String(payload?.error_description || payload?.error || 'unknown').slice(0, 300)}`)
  }
  cachedToken = {
    value: String(payload.access_token),
    expiresAt: now + Math.max(300, Number(payload.expires_in || 3600)) * 1000,
  }
  return cachedToken.value
}

const gcsFetch = async (credentials, url, options = {}) => {
  const token = await getGcsAccessToken(credentials)
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      authorization: `Bearer ${token}`,
    },
    signal: options.signal || AbortSignal.timeout(30_000),
  })
  return response
}

export async function* listGcsObjects(credentials, bucket, { prefix = '' } = {}) {
  let pageToken = ''
  do {
    const url = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`)
    url.searchParams.set('maxResults', '1000')
    url.searchParams.set('fields', 'items(name,size,contentType,updated,md5Hash,crc32c,generation),nextPageToken')
    if (prefix) url.searchParams.set('prefix', prefix)
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const response = await gcsFetch(credentials, url)
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(`GCS list failed for ${bucket} (${response.status}): ${redactError(payload?.error?.message || payload?.error || 'unknown')}`)
    }

    for (const item of payload.items || []) {
      if (!item?.name) continue
      yield {
        key: String(item.name),
        size: Number(item.size || 0),
        contentType: String(item.contentType || 'application/octet-stream'),
        updatedAt: item.updated ? new Date(item.updated).toISOString() : null,
        md5Hash: String(item.md5Hash || ''),
        crc32c: String(item.crc32c || ''),
        generation: String(item.generation || ''),
      }
    }
    pageToken = String(payload.nextPageToken || '')
  } while (pageToken)
}

export const downloadGcsObject = async (credentials, bucket, key, maxBytes = 32 * 1024 * 1024) => {
  const url = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}`)
  url.searchParams.set('alt', 'media')
  const response = await gcsFetch(credentials, url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`GCS download failed for ${bucket}/${key} (${response.status})`)
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared && declared > maxBytes) throw new Error(`GCS object exceeds verification download limit (${declared} > ${maxBytes})`)
  const body = Buffer.from(await response.arrayBuffer())
  if (body.length > maxBytes) throw new Error(`GCS object exceeds verification download limit (${body.length} > ${maxBytes})`)
  return body
}
