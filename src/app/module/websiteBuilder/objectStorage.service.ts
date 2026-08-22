import { createHash, createHmac, randomUUID } from 'crypto'
import config from '../../../config'
import { API_ERROR_CODES } from '../../../contracts/apiContract'
import ApiError from '../../../errors/ApiError'
import { Resilience } from '../../../shared/resilience'

const encodePath = (value: string) => value.split('/').filter(Boolean).map(encodeURIComponent).join('/')
const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value).digest()
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

const configurationStatus = () => {
  const storage = config.assets
  const missing: string[] = []
  if (!storage.endpoint) missing.push('OBJECT_STORAGE_ENDPOINT')
  if (!storage.bucket) missing.push('OBJECT_STORAGE_BUCKET')
  if (!storage.region) missing.push('OBJECT_STORAGE_REGION')
  if (!storage.access_key_id) missing.push('OBJECT_STORAGE_ACCESS_KEY_ID')
  if (!storage.secret_access_key) missing.push('OBJECT_STORAGE_SECRET_ACCESS_KEY')
  if (!storage.public_base_url) missing.push('OBJECT_STORAGE_PUBLIC_BASE_URL')
  if (storage.require_internal_endpoint && !storage.internal_endpoint) missing.push('OBJECT_STORAGE_INTERNAL_ENDPOINT')
  return { configured: missing.length === 0, missing }
}

const notConfiguredError = (missing = configurationStatus().missing) => new ApiError(
  503,
  'Property media storage is not configured on this server',
  '',
  API_ERROR_CODES.OBJECT_STORAGE_NOT_CONFIGURED,
  { missing },
)

const unavailableError = (message = 'Property media storage is temporarily unavailable', details?: Record<string, unknown>) => new ApiError(
  503,
  message,
  '',
  API_ERROR_CODES.OBJECT_STORAGE_UNAVAILABLE,
  details,
)

const assertConfigured = () => {
  const status = configurationStatus()
  if (!status.configured) throw notConfiguredError(status.missing)
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
  let response: Response
  try {
    response = await Resilience.fetch('object-storage', presign('HEAD', key, 120, 'internal'), { method: 'HEAD' }, { timeoutMs: config.assets.health_timeout_ms })
  } catch (error: any) {
    if (error instanceof ApiError) throw error
    throw unavailableError('Property media storage could not be reached', { operation: 'head', reason: String(error?.message || 'unreachable').slice(0, 160) })
  }
  if (!response.ok) {
    if (response.status >= 500 || response.status === 401 || response.status === 403 || response.status === 429) {
      throw unavailableError('Property media storage rejected the request', { operation: 'head', status: response.status })
    }
    throw new ApiError(409, `Uploaded object is not available (${response.status})`)
  }
  return {
    size: Number(response.headers.get('content-length') || 0),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    etag: (response.headers.get('etag') || '').replace(/"/g, ''),
  }
}

const putBuffer = async (key: string, body: Buffer, contentType: string) => {
  let response: Response
  try {
    response = await Resilience.fetch(
      'object-storage',
      presign('PUT', key, Math.max(120, config.assets.signed_url_ttl_seconds), 'internal'),
      { method: 'PUT', headers: { 'content-type': contentType }, body: body as any },
      { timeoutMs: Math.max(15_000, config.assets.health_timeout_ms) },
    )
  } catch (error: any) {
    if (error instanceof ApiError) throw error
    throw unavailableError('Property media storage upload could not be reached', { operation: 'put', reason: String(error?.message || 'unreachable').slice(0, 160) })
  }
  if (!response.ok) throw unavailableError('Property media storage rejected the upload', { operation: 'put', status: response.status })
}

const remove = async (key: string) => {
  let response: Response
  try {
    response = await Resilience.fetch('object-storage', presign('DELETE', key, 120, 'internal'), { method: 'DELETE' }, { timeoutMs: config.assets.health_timeout_ms })
  } catch (error: any) {
    if (error instanceof ApiError) throw error
    throw unavailableError('Property media storage delete could not be reached', { operation: 'delete', reason: String(error?.message || 'unreachable').slice(0, 160) })
  }
  if (!response.ok && response.status !== 404) throw unavailableError('Property media storage rejected the delete request', { operation: 'delete', status: response.status })
}

type CorsMethod = 'PUT' | 'GET' | 'HEAD'
type CorsProbeResult = { method: CorsMethod; healthy: boolean; status?: number; allowOrigin?: string; allowMethods?: string; allowHeaders?: string; detail?: string }

const includesHeaderToken = (value: string, token: string) => value.split(',').map((part) => part.trim().toLowerCase()).some((part) => part === '*' || part === token.toLowerCase())

const probeBrowserCorsMethod = async (method: CorsMethod, key: string): Promise<CorsProbeResult> => {
  const url = presign(method, key, 60, 'browser')
  try {
    const response = await Resilience.fetch(
      'object-storage-cors',
      url,
      {
        method: 'OPTIONS',
        headers: {
          origin: config.assets.browser_origin,
          'access-control-request-method': method,
          'access-control-request-headers': 'content-type',
        },
      },
      { timeoutMs: config.assets.health_timeout_ms },
    )
    const allowOrigin = response.headers.get('access-control-allow-origin') || ''
    const allowMethods = response.headers.get('access-control-allow-methods') || ''
    const allowHeaders = response.headers.get('access-control-allow-headers') || ''
    const originAllowed = allowOrigin === '*' || allowOrigin === config.assets.browser_origin
    const methodAllowed = includesHeaderToken(allowMethods, method)
    const contentTypeAllowed = includesHeaderToken(allowHeaders, 'content-type')
    return {
      method,
      healthy: response.ok && originAllowed && methodAllowed && contentTypeAllowed,
      status: response.status,
      allowOrigin,
      allowMethods,
      allowHeaders,
      ...(!response.ok ? { detail: `preflight_${response.status}` } : !originAllowed ? { detail: 'origin_not_allowed' } : !methodAllowed ? { detail: 'method_not_allowed' } : !contentTypeAllowed ? { detail: 'content_type_not_allowed' } : {}),
    }
  } catch (error: any) {
    return { method, healthy: false, detail: String(error?.message || 'preflight_failed').slice(0, 160) }
  }
}

const browserCorsHealth = async () => {
  assertConfigured()
  const key = `__health/cors-${randomUUID()}.probe`
  const probes = await Promise.all((['PUT', 'GET', 'HEAD'] as CorsMethod[]).map((method) => probeBrowserCorsMethod(method, key)))
  return {
    origin: config.assets.browser_origin,
    requiredMethods: ['PUT', 'GET', 'HEAD'] as CorsMethod[],
    requiredHeaders: ['Content-Type'],
    healthy: probes.every((probe) => probe.healthy),
    probes,
  }
}

type StorageHealth = {
  configured: boolean
  healthy: boolean
  latencyMs: number
  detail?: string
  missing?: string[]
  endpoint?: string
  internalEndpoint?: string
  bucket?: string
  region?: string
  browserCors?: Awaited<ReturnType<typeof browserCorsHealth>>
}

let lastHealth: { at: number; value: StorageHealth } | null = null
const health = async (): Promise<StorageHealth> => {
  const configuration = configurationStatus()
  if (!configuration.configured) {
    return { configured: false, healthy: false, latencyMs: 0, detail: 'not_configured', missing: configuration.missing }
  }
  const now = Date.now()
  if (lastHealth && now - lastHealth.at < config.assets.health_cache_ms) return lastHealth.value
  const started = performance.now()
  try {
    const [bucketResponse, browserCors] = await Promise.all([
      Resilience.fetch('object-storage-health', presign('HEAD', '', 60, 'internal'), { method: 'HEAD' }, { timeoutMs: config.assets.health_timeout_ms }),
      browserCorsHealth(),
    ])
    const bucketHealthy = bucketResponse.ok
    const healthy = bucketHealthy && browserCors.healthy
    const value: StorageHealth = {
      configured: true,
      healthy,
      latencyMs: Math.round(performance.now() - started),
      endpoint: config.assets.endpoint,
      internalEndpoint: config.assets.internal_endpoint,
      bucket: config.assets.bucket,
      region: config.assets.region,
      browserCors,
      ...(!bucketHealthy ? { detail: `bucket_head_${bucketResponse.status}` } : !browserCors.healthy ? { detail: 'browser_cors_misconfigured' } : {}),
    }
    lastHealth = { at: now, value }
    return value
  } catch (error: any) {
    const value: StorageHealth = {
      configured: true,
      healthy: false,
      latencyMs: Math.round(performance.now() - started),
      endpoint: config.assets.endpoint,
      internalEndpoint: config.assets.internal_endpoint,
      bucket: config.assets.bucket,
      region: config.assets.region,
      detail: String(error?.message || 'unreachable').slice(0, 160),
    }
    lastHealth = { at: now, value }
    return value
  }
}

export const ObjectStorageService = {
  configurationStatus,
  presignUpload: (key: string) => ({ uploadUrl: presign('PUT', key), key, publicUrl: publicUrl(key), expiresIn: config.assets.signed_url_ttl_seconds }),
  presignDownload: (key: string, expires = 120) => presign('GET', key, expires, 'internal'),
  head,
  putBuffer,
  remove,
  publicUrl,
  browserCorsHealth,
  health,
}
