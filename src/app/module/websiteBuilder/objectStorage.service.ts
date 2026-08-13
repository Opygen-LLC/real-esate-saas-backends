import { createHash, createHmac } from 'crypto'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { Resilience } from '../../../shared/resilience'

const encodePath = (value: string) => value.split('/').map(encodeURIComponent).join('/')
const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value).digest()
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

const assertConfigured = () => {
  const storage = config.assets
  if (!storage.endpoint || !storage.bucket || !storage.access_key_id || !storage.secret_access_key) {
    throw new ApiError(503, 'Object storage is not configured')
  }
}

const amzDate = (date: Date) => date.toISOString().replace(/[:-]|\.\d{3}/g, '')

const presign = (method: 'GET' | 'PUT' | 'HEAD' | 'DELETE', key: string, expires = config.assets.signed_url_ttl_seconds) => {
  assertConfigured()
  const endpoint = new URL(config.assets.endpoint)
  const now = new Date()
  const timestamp = amzDate(now)
  const dateStamp = timestamp.slice(0, 8)
  const region = config.assets.region
  const service = 's3'
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const canonicalUri = `/${encodeURIComponent(config.assets.bucket)}/${encodePath(key)}`
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
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex')
  query.set('X-Amz-Signature', signature)
  return `${endpoint.origin}${canonicalUri}?${query.toString()}`
}

const publicUrl = (key: string) => {
  if (config.assets.public_base_url) return `${config.assets.public_base_url}/${encodePath(key)}`
  const endpoint = new URL(config.assets.endpoint)
  return `${endpoint.origin}/${encodeURIComponent(config.assets.bucket)}/${encodePath(key)}`
}

const head = async (key: string) => {
  const response = await Resilience.fetch('object-storage', presign('HEAD', key, 120), { method: 'HEAD' }, { timeoutMs: 10000 })
  if (!response.ok) throw new ApiError(409, `Uploaded object is not available (${response.status})`)
  return {
    size: Number(response.headers.get('content-length') || 0),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    etag: (response.headers.get('etag') || '').replace(/"/g, ''),
  }
}

const remove = async (key: string) => {
  const response = await Resilience.fetch('object-storage', presign('DELETE', key, 120), { method: 'DELETE' }, { timeoutMs: 10000 })
  if (!response.ok && response.status !== 404) throw new ApiError(502, 'Object storage delete failed')
}

export const ObjectStorageService = {
  presignUpload: (key: string) => ({ uploadUrl: presign('PUT', key), key, publicUrl: publicUrl(key), expiresIn: config.assets.signed_url_ttl_seconds }),
  presignDownload: (key: string, expires = 120) => presign('GET', key, expires),
  head,
  remove,
  publicUrl,
}
