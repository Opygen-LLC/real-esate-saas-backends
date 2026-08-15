import { createHash, createHmac } from 'crypto'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { Resilience } from '../../../shared/resilience'

const encodePath = (value: string) => value.split('/').filter(Boolean).map(encodeURIComponent).join('/')
const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value).digest()
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

const assertConfigured = () => {
  const storage = config.assets
  if (!storage.endpoint || !storage.bucket || !storage.access_key_id || !storage.secret_access_key || !storage.public_base_url) {
    throw new ApiError(503, 'Object storage is not configured')
  }
}

const amzDate = (date: Date) => date.toISOString().replace(/[:-]|\.\d{3}/g, '')
const endpointFor = (scope: 'browser' | 'internal') => new URL(scope === 'internal' ? (config.assets.internal_endpoint || config.assets.endpoint) : config.assets.endpoint)
const canonicalUriFor = (key: string) => `/${encodeURIComponent(config.assets.bucket)}${key ? `/${encodePath(key)}` : ''}`

const presign = (
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE',
  key: string,
  expires = config.assets.signed_url_ttl_seconds,
  scope: 'browser' | 'internal' = 'browser',
) => {
  assertConfigured()
  const endpoint = endpointFor(scope)
  const now = new Date()
  const timestamp = amzDate(now)
  const dateStamp = timestamp.slice(0, 8)
  const region = config.assets.region
  const service = 's3'
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const canonicalUri = canonicalUriFor(key)
  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.assets.access_key_id}/${credentialScope}`,
    'X-Amz-Date': timestamp,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  })
  query.sort()
  const canonicalHeaders = `host:${endpoint.host}\n`
  const canonicalRequest = [method, canonicalUri, query.toString(), canonicalHeaders, 'host', 'UNSIGNED-PAYLOAD'].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', timestamp, credentialScope, sha256(canonicalRequest)].join('\n')
  const kDate = hmac(`AWS4${config.assets.secret_access_key}`, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  const kSigning = hmac(kService, 'aws4_request')
  query.set('X-Amz-Signature', createHmac('sha256', kSigning).update(stringToSign).digest('hex'))
  return `${endpoint.origin}${canonicalUri}?${query.toString()}`
}

const publicUrl = (key: string) => {
  assertConfigured()
  return `${config.assets.public_base_url}/${encodePath(key)}`
}

const head = async (key: string) => {
  const response = await Resilience.fetch('object-storage', presign('HEAD', key, 120, 'internal'), { method: 'HEAD' }, { timeoutMs: config.assets.health_timeout_ms })
  if (!response.ok) throw new ApiError(409, `Uploaded object is not available (${response.status})`)
  return {
    size: Number(response.headers.get('content-length') || 0),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    etag: (response.headers.get('etag') || '').replace(/"/g, ''),
  }
}

const putBuffer = async (key: string, body: Buffer, contentType: string) => {
  const response = await Resilience.fetch(
    'object-storage',
    presign('PUT', key, Math.max(120, config.assets.signed_url_ttl_seconds), 'internal'),
    { method: 'PUT', headers: { 'content-type': contentType }, body },
    { timeoutMs: Math.max(15_000, config.assets.health_timeout_ms) },
  )
  if (!response.ok) throw new ApiError(502, `Object storage upload failed (${response.status})`)
}

const remove = async (key: string) => {
  const response = await Resilience.fetch('object-storage', presign('DELETE', key, 120, 'internal'), { method: 'DELETE' }, { timeoutMs: config.assets.health_timeout_ms })
  if (!response.ok && response.status !== 404) throw new ApiError(502, 'Object storage delete failed')
}

let lastHealth: { at: number; value: { configured: boolean; healthy: boolean; latencyMs: number; detail?: string } } | null = null
const health = async () => {
  const configured = Boolean(config.assets.endpoint && config.assets.bucket && config.assets.access_key_id && config.assets.secret_access_key && config.assets.public_base_url)
  if (!configured) return { configured: false, healthy: false, latencyMs: 0, detail: 'not_configured' }
  const now = Date.now()
  if (lastHealth && now - lastHealth.at < config.assets.health_cache_ms) return lastHealth.value
  const started = performance.now()
  try {
    const response = await Resilience.fetch('object-storage-health', presign('HEAD', '', 60, 'internal'), { method: 'HEAD' }, { timeoutMs: config.assets.health_timeout_ms })
    const value = { configured: true, healthy: response.ok, latencyMs: Math.round(performance.now() - started), ...(response.ok ? {} : { detail: `bucket_head_${response.status}` }) }
    lastHealth = { at: now, value }
    return value
  } catch (error: any) {
    const value = { configured: true, healthy: false, latencyMs: Math.round(performance.now() - started), detail: String(error?.message || 'unreachable').slice(0, 160) }
    lastHealth = { at: now, value }
    return value
  }
}

export const ObjectStorageService = {
  presignUpload: (key: string) => ({ uploadUrl: presign('PUT', key), key, publicUrl: publicUrl(key), expiresIn: config.assets.signed_url_ttl_seconds }),
  presignDownload: (key: string, expires = 120) => presign('GET', key, expires, 'internal'),
  head,
  putBuffer,
  remove,
  publicUrl,
  health,
}
