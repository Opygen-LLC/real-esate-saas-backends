/**
 * Unified object-storage abstraction backed by Cloudflare R2's S3-compatible API.
 *
 * Business modules intentionally depend only on ObjectStorageService. Provider
 * credentials, bucket routing, signing, CORS checks, and S3 details stay here so
 * a storage-provider change does not leak into property, website, support, or
 * supplier modules.
 *
 * Canonical environment variables:
 *   OBJECT_STORAGE_PROVIDER=r2
 *   R2_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_PUBLIC_BUCKET_NAME
 *   R2_PRIVATE_BUCKET_NAME
 *   R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
 *   OBJECT_STORAGE_PUBLIC_BASE_URL
 *   OBJECT_STORAGE_BROWSER_ORIGIN
 *   OBJECT_STORAGE_SIGNED_URL_TTL
 */

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetBucketCorsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import config from '../../../config'
import { API_ERROR_CODES } from '../../../contracts/apiContract'
import ApiError from '../../../errors/ApiError'

const PRIVATE_KEY_PATTERNS = [
  /^support\//,
  /^tenants\/[^/]+\/properties\/documents\//,
  /^tenants\/[^/]+\/suppliers\/invoices\//,
  /^tenants\/[^/]+\/upload-staging\//,
]

const normalizeObjectKey = (value: string): string => {
  const key = String(value || '').trim().replace(/^\/+/, '')
  if (!key || key.includes('\\') || key.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new ApiError(400, 'Invalid object storage key')
  }
  return key
}

const normalizePrefix = (value: string): string => {
  const prefix = String(value || '').trim().replace(/^\/+/, '')
  if (!prefix || prefix.includes('\\') || prefix.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new ApiError(400, 'Storage deletion prefix is required')
  }
  return prefix
}

const isPrivateKey = (value: string): boolean => {
  const key = normalizeObjectKey(value)
  return PRIVATE_KEY_PATTERNS.some((pattern) => pattern.test(key))
}

const publicBucketName = () => config.assets.r2_public_bucket_name
const privateBucketName = () => config.assets.r2_private_bucket_name
const writeBucketNameForKey = (key: string): string => isPrivateKey(key) ? privateBucketName() : publicBucketName()

const candidateBucketNamesForKey = (key: string): string[] => {
  const primary = writeBucketNameForKey(key)
  // Idempotent rollout safety: if a private object was historically written to
  // the public R2 bucket, reads/deletes can still find it until migration moves it.
  return isPrivateKey(key) && primary !== publicBucketName()
    ? [primary, publicBucketName()]
    : [primary]
}

const httpStatusCode = (error: any): number | undefined => {
  const raw = error?.$metadata?.httpStatusCode ?? error?.statusCode ?? error?.status ?? error?.code
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

const isNotFound = (error: any): boolean => {
  const name = String(error?.name || error?.Code || error?.code || '')
  return httpStatusCode(error) === 404 || ['NoSuchKey', 'NotFound', 'NoSuchBucket'].includes(name)
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

let _r2: S3Client | null = null
const r2 = (): S3Client => {
  if (!_r2) {
    _r2 = new S3Client({
      region: 'auto',
      endpoint: config.assets.r2_endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.assets.r2_access_key_id,
        secretAccessKey: config.assets.r2_secret_access_key,
      },
      // R2 uses the S3-compatible protocol, but browser presigned PUTs do not
      // have the request body available while the URL is being signed. Newer
      // AWS SDK versions otherwise add a CRC32 checksum for an empty body to
      // the presigned URL, which makes the real browser payload fail.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      maxAttempts: 3,
    })
  }
  return _r2
}

const configurationStatus = () => {
  const missing: string[] = []
  if (config.assets.provider !== 'r2') missing.push('OBJECT_STORAGE_PROVIDER=r2')
  if (!config.assets.r2_account_id) missing.push('R2_ACCOUNT_ID')
  if (!config.assets.r2_access_key_id) missing.push('R2_ACCESS_KEY_ID')
  if (!config.assets.r2_secret_access_key) missing.push('R2_SECRET_ACCESS_KEY')
  if (!publicBucketName()) missing.push('R2_PUBLIC_BUCKET_NAME')
  if (!config.assets.r2_private_bucket_name) missing.push('R2_PRIVATE_BUCKET_NAME')
  if (!config.assets.r2_endpoint) missing.push('R2_ENDPOINT')
  if (!config.assets.public_base_url) missing.push('OBJECT_STORAGE_PUBLIC_BASE_URL')
  if (config.isProduction && publicBucketName() && privateBucketName() && publicBucketName() === privateBucketName()) {
    missing.push('R2_PRIVATE_BUCKET_NAME (must differ from R2_PUBLIC_BUCKET_NAME)')
  }

  return {
    provider: 'r2' as const,
    configured: missing.length === 0,
    missing,
    accountId: config.assets.r2_account_id,
    endpoint: config.assets.r2_endpoint,
    bucket: publicBucketName(),
    privateBucket: privateBucketName(),
    region: 'auto' as const,
    authMode: 'r2-api-token' as const,
    imageTransformations: {
      enabled: Boolean(config.assets.image_transformations_enabled),
      baseUrl: config.assets.image_transform_base_url || '',
    },
    migration: {
      mode: config.assets.migration_mode,
      legacyGcsPublicBucket: config.assets.legacy_gcs_public_bucket_name || '',
      legacyGcsPrivateBucket: config.assets.legacy_gcs_private_bucket_name || '',
    },
  }
}

const notConfiguredError = (missing = configurationStatus().missing) => new ApiError(
  503,
  'Property media storage is not configured on this server',
  '',
  API_ERROR_CODES.OBJECT_STORAGE_NOT_CONFIGURED,
  { missing },
)

const unavailableError = (message = 'Property media storage is temporarily unavailable', details?: Record<string, unknown>) =>
  new ApiError(503, message, '', API_ERROR_CODES.OBJECT_STORAGE_UNAVAILABLE, details)

const assertConfigured = () => {
  const status = configurationStatus()
  if (!status.configured) throw notConfiguredError(status.missing)
}

const encodePath = (value: string) => value.split('/').filter(Boolean).map(encodeURIComponent).join('/')

const publicUrl = (key: string): string => {
  assertConfigured()
  const normalized = normalizeObjectKey(key)
  if (isPrivateKey(normalized)) throw new ApiError(400, 'Private media cannot be exposed through a public object URL')
  return `${String(config.assets.public_base_url).replace(/\/+$/, '')}/${encodePath(normalized)}`
}

const publicImageUrl = (key: string): string => {
  const source = publicUrl(key)
  if (!config.assets.image_transformations_enabled || !config.assets.image_transform_base_url) return source
  const base = String(config.assets.image_transform_base_url).replace(/\/+$/, '')
  const options = 'width=auto,wbreakpoints=320;480;640;960;1280;1600;1920,quality=82,format=auto,fit=scale-down,metadata=none'
  return `${base}/cdn-cgi/image/${options}/${source}`
}

const unwrapImageTransformationSource = (value: string): string => {
  try {
    const parsed = new URL(value)
    const marker = '/cdn-cgi/image/'
    const index = parsed.pathname.indexOf(marker)
    if (index < 0) return value
    const after = parsed.pathname.slice(index + marker.length)
    const slash = after.indexOf('/')
    if (slash < 0) return value
    const encodedSource = after.slice(slash + 1)
    if (!/^https?:\/\//i.test(encodedSource)) return value
    return decodeURIComponent(encodedSource)
  } catch {
    return value
  }
}

const legacyGcsReferenceKey = (value: string): string | null => {
  if (config.assets.migration_mode !== 'sippy') return null
  const allowedBuckets = new Set([
    config.assets.legacy_gcs_public_bucket_name,
    config.assets.legacy_gcs_private_bucket_name,
  ].filter(Boolean))
  if (!allowedBuckets.size) return null

  const raw = String(value || '').trim()
  if (!raw) return null
  let bucket = ''
  let key = ''

  if (raw.startsWith('gs://')) {
    const withoutScheme = raw.slice(5)
    const slash = withoutScheme.indexOf('/')
    if (slash <= 0) return null
    bucket = withoutScheme.slice(0, slash)
    key = withoutScheme.slice(slash + 1)
  } else {
    try {
      const parsed = new URL(raw)
      const host = parsed.hostname.toLowerCase()
      const pathname = parsed.pathname.replace(/^\/+/, '')
      if (host === 'storage.googleapis.com') {
        const slash = pathname.indexOf('/')
        if (slash <= 0) return null
        bucket = decodeURIComponent(pathname.slice(0, slash))
        key = decodeURIComponent(pathname.slice(slash + 1))
      } else if (host.endsWith('.storage.googleapis.com')) {
        bucket = host.slice(0, -'.storage.googleapis.com'.length)
        key = decodeURIComponent(pathname)
      } else {
        return null
      }
    } catch {
      return null
    }
  }

  if (!allowedBuckets.has(bucket) || !key) return null
  try { return normalizeObjectKey(key) } catch { return null }
}

/**
 * Resolve an object key from either a raw key or a URL owned by this R2 setup.
 * Unknown/external URLs return null so tenant purge cannot delete third-party data.
 */
const keyFromReference = (value: string): string | null => {
  const raw = unwrapImageTransformationSource(String(value || '').trim())
  if (!raw) return null

  const legacyKey = legacyGcsReferenceKey(raw)
  if (legacyKey) return legacyKey

  if (!/^https?:\/\//i.test(raw)) {
    try { return normalizeObjectKey(raw) } catch { return null }
  }

  try {
    const parsed = new URL(raw)
    const decodedPath = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
    const configuredBase = String(config.assets.public_base_url || '').replace(/\/+$/, '')
    if (configuredBase) {
      const base = new URL(configuredBase)
      const basePath = base.pathname.replace(/\/+$/, '')
      if (parsed.origin === base.origin && (basePath === '' || parsed.pathname.startsWith(`${basePath}/`))) {
        const relative = basePath ? parsed.pathname.slice(basePath.length + 1) : parsed.pathname.replace(/^\/+/, '')
        return relative ? decodeURIComponent(relative) : null
      }
    }

    const endpoint = new URL(config.assets.r2_endpoint)
    if (parsed.origin === endpoint.origin && decodedPath.startsWith(`${publicBucketName()}/`)) {
      return decodedPath.slice(publicBucketName().length + 1) || null
    }

    const virtualHost = `${publicBucketName()}.${endpoint.hostname}`.toLowerCase()
    if (parsed.hostname.toLowerCase() === virtualHost) return decodedPath || null
  } catch {
    return null
  }
  return null
}

const resolveExistingBucketName = async (key: string): Promise<string> => {
  for (const bucket of candidateBucketNamesForKey(key)) {
    try {
      await r2().send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      return bucket
    } catch (error: any) {
      if (isNotFound(error)) continue
      throw error
    }
  }
  return writeBucketNameForKey(key)
}

const presign = async (
  method: 'GET' | 'PUT',
  key: string,
  expiresInSeconds = config.assets.signed_url_ttl_seconds,
  contentType?: string,
): Promise<string> => {
  assertConfigured()
  const normalized = normalizeObjectKey(key)
  const expiresIn = Math.min(Math.max(30, Math.trunc(expiresInSeconds)), 3600)

  try {
    if (method === 'PUT') {
      const command = new PutObjectCommand({
        Bucket: writeBucketNameForKey(normalized),
        Key: normalized,
        ...(contentType ? { ContentType: contentType } : {}),
      })
      const uploadUrl = await getSignedUrl(r2(), command, {
        expiresIn,
        ...(contentType ? { signableHeaders: new Set(['content-type']) } : {}),
      })
      const parsed = new URL(uploadUrl)
      if (parsed.searchParams.has('x-amz-checksum-crc32') || parsed.searchParams.has('x-amz-sdk-checksum-algorithm')) {
        throw new Error('r2_presign_contains_automatic_payload_checksum')
      }
      return uploadUrl
    }

    const bucket = await resolveExistingBucketName(normalized)
    return await getSignedUrl(r2(), new GetObjectCommand({ Bucket: bucket, Key: normalized }), { expiresIn })
  } catch (error: any) {
    if (error instanceof ApiError) throw error
    throw unavailableError('Could not generate a signed URL from Cloudflare R2', {
      operation: method,
      reason: String(error?.message || 'r2_signing_failed').slice(0, 200),
    })
  }
}

const presignUpload = (key: string, contentType?: string) => {
  assertConfigured()
  const normalized = normalizeObjectKey(key)
  return {
    key: normalized,
    publicUrl: isPrivateKey(normalized) ? '' : publicUrl(normalized),
    // Kept for API compatibility. R2 signing is asynchronous; callers use getUploadUrl().
    uploadUrl: '',
    getUploadUrl: () => presign('PUT', normalized, config.assets.signed_url_ttl_seconds, contentType),
    expiresIn: config.assets.signed_url_ttl_seconds,
    contentType: contentType || '',
  }
}

const presignDownload = async (key: string, expiresInSeconds = 120) => {
  assertConfigured()
  const normalized = normalizeObjectKey(key)
  const expiresIn = Math.min(Math.max(30, Math.trunc(expiresInSeconds)), 300)
  try {
    const bucket = await resolveExistingBucketName(normalized)
    return await getSignedUrl(r2(), new GetObjectCommand({
      Bucket: bucket,
      Key: normalized,
      ResponseContentDisposition: 'attachment',
      ResponseContentType: 'application/octet-stream',
    }), { expiresIn })
  } catch (error: any) {
    if (error instanceof ApiError) throw error
    throw unavailableError('Could not generate a private download URL from Cloudflare R2', {
      operation: 'GET',
      reason: String(error?.message || 'r2_signing_failed').slice(0, 200),
    })
  }
}

const putBuffer = async (key: string, body: Buffer, contentType: string): Promise<void> => {
  assertConfigured()
  const normalized = normalizeObjectKey(key)
  try {
    await r2().send(new PutObjectCommand({
      Bucket: writeBucketNameForKey(normalized),
      Key: normalized,
      Body: body,
      ContentType: contentType,
      ContentLength: body.length,
    }))
  } catch (error: any) {
    if (error instanceof ApiError) throw error
    throw unavailableError('Cloudflare R2 upload failed', {
      operation: 'put',
      reason: String(error?.message || 'r2_write_failed').slice(0, 200),
    })
  }
}

const head = async (key: string) => {
  assertConfigured()
  const normalized = normalizeObjectKey(key)
  try {
    for (const bucket of candidateBucketNamesForKey(normalized)) {
      try {
        const result = await r2().send(new HeadObjectCommand({ Bucket: bucket, Key: normalized }))
        return {
          size: Number(result.ContentLength || 0),
          contentType: String(result.ContentType || 'application/octet-stream'),
          etag: String(result.ETag || '').replace(/"/g, ''),
        }
      } catch (error: any) {
        if (isNotFound(error)) continue
        throw error
      }
    }
    throw new ApiError(409, 'Uploaded object is not available (404)')
  } catch (error: any) {
    if (error instanceof ApiError) throw error
    const status = httpStatusCode(error)
    if (status === 401 || status === 403) throw unavailableError('Cloudflare R2 rejected the request', { operation: 'head', status })
    throw unavailableError('Cloudflare R2 could not be reached', {
      operation: 'head',
      reason: String(error?.message || 'r2_head_failed').slice(0, 200),
    })
  }
}

const readBuffer = async (key: string, maxBytes = 25 * 1024 * 1024): Promise<Buffer> => {
  assertConfigured()
  const normalized = normalizeObjectKey(key)
  try {
    for (const bucket of candidateBucketNamesForKey(normalized)) {
      try {
        const metadata = await r2().send(new HeadObjectCommand({ Bucket: bucket, Key: normalized }))
        const declaredSize = Number(metadata.ContentLength || 0)
        if (declaredSize > maxBytes) throw new ApiError(413, 'Stored media exceeds the safe processing size limit')
        const result = await r2().send(new GetObjectCommand({ Bucket: bucket, Key: normalized }))
        if (!result.Body) throw new Error('r2_empty_body')
        const stream = result.Body as any
        const bytes: Uint8Array = typeof stream.transformToByteArray === 'function'
          ? await stream.transformToByteArray()
          : Buffer.concat(await (async () => {
              const chunks: Buffer[] = []
              for await (const chunk of stream as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk))
              return chunks
            })())
        const body = Buffer.from(bytes)
        if (body.length > maxBytes) throw new ApiError(413, 'Stored media exceeds the safe processing size limit')
        return body
      } catch (error: any) {
        if (error instanceof ApiError) throw error
        if (isNotFound(error)) continue
        throw error
      }
    }
    throw new ApiError(409, 'Uploaded object is not available (404)')
  } catch (error: any) {
    if (error instanceof ApiError) throw error
    const status = httpStatusCode(error)
    if (status === 401 || status === 403) throw unavailableError('Cloudflare R2 rejected the media read request', { operation: 'read', status })
    throw unavailableError('Cloudflare R2 media read failed', {
      operation: 'read',
      reason: String(error?.message || 'r2_read_failed').slice(0, 200),
    })
  }
}

const remove = async (key: string): Promise<void> => {
  assertConfigured()
  const normalized = normalizeObjectKey(key)
  try {
    await Promise.all(candidateBucketNamesForKey(normalized).map((bucket) =>
      r2().send(new DeleteObjectCommand({ Bucket: bucket, Key: normalized }))
    ))
  } catch (error: any) {
    if (error instanceof ApiError) throw error
    throw unavailableError('Cloudflare R2 delete failed', {
      operation: 'delete',
      reason: String(error?.message || 'r2_delete_failed').slice(0, 200),
    })
  }
}

const deletePrefixFromBucket = async (bucket: string, prefix: string): Promise<void> => {
  let continuationToken: string | undefined
  do {
    const page = await r2().send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 1000,
      ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
    }))
    const objects = (page.Contents || []).flatMap((entry) => entry.Key ? [{ Key: entry.Key }] : [])
    if (objects.length) {
      await r2().send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }))
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (continuationToken)
}

/** Delete every object below a tenant-owned prefix. Idempotent by design. */
const removePrefix = async (prefix: string): Promise<void> => {
  assertConfigured()
  const normalized = normalizePrefix(prefix)
  try {
    const buckets = [...new Set([publicBucketName(), privateBucketName()].filter(Boolean))]
    await Promise.all(buckets.map((bucket) => deletePrefixFromBucket(bucket, normalized)))
  } catch (error: any) {
    if (error instanceof ApiError) throw error
    throw unavailableError('Cloudflare R2 prefix deletion failed', {
      operation: 'delete_prefix',
      prefix: normalized,
      reason: String(error?.message || 'r2_prefix_delete_failed').slice(0, 200),
    })
  }
}

const prefixHasObjects = async (prefix: string): Promise<boolean> => {
  assertConfigured()
  const normalized = String(prefix || '').trim().replace(/^\/+/, '')
  if (!normalized) return false
  try {
    const buckets = [...new Set([publicBucketName(), privateBucketName()].filter(Boolean))]
    for (const bucket of buckets) {
      const page = await r2().send(new ListObjectsV2Command({ Bucket: bucket, Prefix: normalized, MaxKeys: 1 }))
      if ((page.KeyCount || page.Contents?.length || 0) > 0) return true
    }
    return false
  } catch (error: any) {
    if (error instanceof ApiError) throw error
    throw unavailableError('Cloudflare R2 prefix verification failed', {
      operation: 'verify_prefix',
      prefix: normalized,
      reason: String(error?.message || 'r2_prefix_verify_failed').slice(0, 200),
    })
  }
}

const exists = async (key: string): Promise<boolean> => {
  assertConfigured()
  const normalized = normalizeObjectKey(key)
  try {
    for (const bucket of candidateBucketNamesForKey(normalized)) {
      try {
        await r2().send(new HeadObjectCommand({ Bucket: bucket, Key: normalized }))
        return true
      } catch (error: any) {
        if (isNotFound(error)) continue
        throw error
      }
    }
    return false
  } catch (error: any) {
    if (error instanceof ApiError) throw error
    throw unavailableError('Cloudflare R2 object existence check failed', {
      operation: 'exists',
      reason: String(error?.message || 'r2_exists_failed').slice(0, 200),
    })
  }
}

const corsRules = async (bucket: string) => {
  try {
    const result = await r2().send(new GetBucketCorsCommand({ Bucket: bucket }))
    return result.CORSRules || []
  } catch (error: any) {
    if (String(error?.name || '') === 'NoSuchCORSConfiguration' || httpStatusCode(error) === 404) return []
    throw error
  }
}

const browserCorsHealth = async () => {
  assertConfigured()
  const origin = config.assets.browser_origin
  const requiredMethods = ['PUT', 'GET', 'HEAD']
  const requiredHeaders = ['Content-Type']
  try {
    const rules = await corsRules(publicBucketName())
    const originAllowed = rules.some((rule) => (rule.AllowedOrigins || []).includes(origin))
    const methodsAllowed = rules.some((rule) => requiredMethods.every((method) => (rule.AllowedMethods || []).includes(method)))
    const headersAllowed = rules.some((rule) => {
      const headers = (rule.AllowedHeaders || []).map((header) => header.toLowerCase())
      return headers.includes('*') || headers.includes('content-type')
    })
    const healthy = rules.length > 0 && originAllowed && methodsAllowed && headersAllowed
    return {
      origin,
      requiredMethods,
      requiredHeaders,
      healthy,
      corsRules: rules,
      detail: !rules.length ? 'no_cors_rules' : !originAllowed ? 'origin_not_in_cors' : !methodsAllowed ? 'methods_not_in_cors' : !headersAllowed ? 'content_type_header_not_in_cors' : undefined,
    }
  } catch (error: any) {
    return { origin, requiredMethods, requiredHeaders, healthy: false, detail: String(error?.message || 'cors_check_failed').slice(0, 200) }
  }
}

const privateBucketSecurityHealth = async () => {
  assertConfigured()
  const bucket = privateBucketName()
  const origin = config.assets.browser_origin
  try {
    if (bucket === publicBucketName()) return { healthy: false, bucket, detail: 'private_bucket_matches_public_bucket' }
    await r2().send(new HeadBucketCommand({ Bucket: bucket }))
    const rules = await corsRules(bucket)
    const safeRule = rules.find((rule) => {
      const origins = rule.AllowedOrigins || []
      const methods = rule.AllowedMethods || []
      return origins.includes(origin) && !origins.includes('*') && ['PUT', 'GET', 'HEAD'].every((method) => methods.includes(method))
    })
    if (!safeRule) return { healthy: false, bucket, origin, detail: 'private_bucket_cors_misconfigured' }
    // R2 buckets are private by default. Public custom-domain/r2.dev exposure is a
    // Cloudflare control-plane setting and is intentionally not inferred from S3.
    return { healthy: true, bucket, origin, accessModel: 'r2-private-by-default' as const }
  } catch (error: any) {
    return { healthy: false, bucket, origin, detail: `private_bucket_security_check_failed:${String(error?.message || 'unknown').slice(0, 160)}` }
  }
}

type StorageHealth = {
  provider: 'r2'
  configured: boolean
  healthy: boolean
  latencyMs: number
  accountId?: string
  endpoint?: string
  detail?: string
  missing?: string[]
  bucket?: string
  browserCors?: Awaited<ReturnType<typeof browserCorsHealth>>
  privateBucket?: Awaited<ReturnType<typeof privateBucketSecurityHealth>>
}

let lastHealth: { at: number; value: StorageHealth } | null = null

const health = async (): Promise<StorageHealth> => {
  const configuration = configurationStatus()
  if (!configuration.configured) {
    return {
      provider: 'r2',
      configured: false,
      healthy: false,
      latencyMs: 0,
      detail: 'not_configured',
      missing: configuration.missing,
      accountId: configuration.accountId,
      endpoint: configuration.endpoint,
      bucket: configuration.bucket,
    }
  }

  const now = Date.now()
  if (lastHealth && now - lastHealth.at < config.assets.health_cache_ms) return lastHealth.value
  const started = performance.now()
  try {
    await withTimeout(r2().send(new HeadBucketCommand({ Bucket: publicBucketName() })), config.assets.health_timeout_ms, 'r2_public_bucket_health')
    const [browserCors, privateBucket] = await withTimeout(
      Promise.all([browserCorsHealth(), privateBucketSecurityHealth()]),
      config.assets.health_timeout_ms,
      'r2_storage_policy_health',
    )
    // Direct browser uploads are a production dependency in Phase 3, so a
    // missing/incorrect public-bucket CORS policy must fail storage readiness.
    const healthy = !config.isProduction || (privateBucket.healthy && browserCors.healthy)
    const value: StorageHealth = {
      provider: 'r2',
      configured: true,
      healthy,
      latencyMs: Math.round(performance.now() - started),
      accountId: configuration.accountId,
      endpoint: configuration.endpoint,
      bucket: publicBucketName(),
      browserCors,
      privateBucket,
      ...(!privateBucket.healthy ? { detail: privateBucket.detail } : !browserCors.healthy ? { detail: 'browser_cors_misconfigured' } : {}),
    }
    lastHealth = { at: now, value }
    return value
  } catch (error: any) {
    const value: StorageHealth = {
      provider: 'r2',
      configured: true,
      healthy: false,
      latencyMs: Math.round(performance.now() - started),
      accountId: configuration.accountId,
      endpoint: configuration.endpoint,
      bucket: publicBucketName(),
      detail: String(error?.message || 'r2_unreachable').slice(0, 200),
    }
    lastHealth = { at: now, value }
    return value
  }
}

export const ObjectStorageService = {
  configurationStatus,
  isPrivateKey,
  presignUpload,
  presignDownload,
  head,
  readBuffer,
  putBuffer,
  remove,
  removePrefix,
  prefixHasObjects,
  exists,
  keyFromReference,
  publicUrl,
  publicImageUrl,
  browserCorsHealth,
  privateBucketSecurityHealth,
  health,
}
