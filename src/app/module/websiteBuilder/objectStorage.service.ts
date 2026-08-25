/**
 * objectStorage.service.ts
 *
 * Unified object-storage abstraction backed by Google Cloud Storage (GCS).
 *
 * Why GCS instead of S3/MinIO?
 * The project already has @google-cloud/storage installed and a working GCS
 * bucket (realestate-saas). This service replaces the previous S3-presigned-URL
 * implementation so that property photos, website-builder media, and support
 * attachments all flow through the same GCS bucket — no MinIO or S3 credentials
 * needed.
 *
 * Canonical environment variables:
 *   GCP_PROJECT_ID                         — GCS project
 *   GCP_BUCKET_NAME                        — GCS bucket (e.g. realestate-saas)
 *   GCP_KEY_FILE                           — optional path to service-account JSON key
 * Legacy PROJECTS_ID / BUCKET_NAME / KEYFILENAME aliases are normalized once in config.
 *   OBJECT_STORAGE_PUBLIC_BASE_URL      — public URL prefix for stored objects
 *                                         e.g. https://storage.googleapis.com/realestate-saas
 *   OBJECT_STORAGE_SIGNED_URL_TTL       — presigned URL lifetime in seconds (default 600)
 *   OBJECT_STORAGE_BROWSER_ORIGIN       — allowed CORS origin for browser uploads
 */

import { Storage, GetSignedUrlConfig } from '@google-cloud/storage'
import { createHash, randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import config from '../../../config'
import { API_ERROR_CODES } from '../../../contracts/apiContract'
import ApiError from '../../../errors/ApiError'

// ─── GCS client initialisation ───────────────────────────────────────────────

const resolveKeyFile = (raw: string): string => {
  const abs = path.resolve(process.cwd(), raw)
  if (fs.existsSync(abs)) return abs
  const parent = path.resolve(process.cwd(), '..', raw)
  if (fs.existsSync(parent)) return parent
  return abs // will fail later with a clear message
}

const buildGcsClient = () => {
  const opts: { projectId?: string; keyFilename?: string } = {}
  if (config.assets.gcp_project_id) opts.projectId = config.assets.gcp_project_id
  if (config.assets.gcp_key_file) {
    const resolved = resolveKeyFile(config.assets.gcp_key_file)
    if (fs.existsSync(resolved)) opts.keyFilename = resolved
  }
  return new Storage(opts)
}

let _gcs: Storage | null = null
const gcs = () => { if (!_gcs) _gcs = buildGcsClient(); return _gcs }

const bucketName = () => config.assets.gcp_bucket_name

// ─── Configuration status ─────────────────────────────────────────────────────

const configurationStatus = () => {
  const missing: string[] = []
  const projectId = config.assets.gcp_project_id
  const keyFileRaw = config.assets.gcp_key_file
  const bucket = bucketName()
  const publicBase = config.assets.public_base_url

  if (!projectId) missing.push('GCP_PROJECT_ID')
  if (!bucket) missing.push('GCP_BUCKET_NAME')
  if (!publicBase) missing.push('OBJECT_STORAGE_PUBLIC_BASE_URL')

  if (keyFileRaw) {
    const resolved = resolveKeyFile(keyFileRaw)
    if (!fs.existsSync(resolved)) missing.push(`GCP_KEY_FILE (file not found: ${resolved})`)
  }
  // If no key file, GCS uses Application Default Credentials (ADC), which is
  // the preferred production mode on GCE / GKE / Cloud Run.
  return {
    provider: 'gcs' as const,
    configured: missing.length === 0,
    missing,
    projectId,
    bucket,
    authMode: keyFileRaw ? 'service-account-key' as const : 'application-default-credentials' as const,
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

// ─── Key / URL helpers ────────────────────────────────────────────────────────

const encodePath = (value: string) =>
  value.split('/').filter(Boolean).map(encodeURIComponent).join('/')

const publicUrl = (key: string): string => {
  assertConfigured()
  return `${config.assets.public_base_url}/${encodePath(key)}`
}


/**
 * Resolve a storage object key from either a raw key or one of the public GCS
 * URL shapes used by this application. Unknown/external URLs return null so a
 * tenant purge can never delete arbitrary third-party objects.
 */
const keyFromReference = (value: string): string | null => {
  const raw = String(value || '').trim()
  if (!raw) return null

  if (!/^https?:\/\//i.test(raw)) {
    const key = raw.replace(/^\/+/, '')
    return key && !key.includes('\\') ? key : null
  }

  const bucket = bucketName()
  if (!bucket) return null
  try {
    const parsed = new URL(raw)
    const pathname = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
    const host = parsed.hostname.toLowerCase()
    if (host === 'storage.googleapis.com' && pathname.startsWith(`${bucket}/`)) {
      return pathname.slice(bucket.length + 1) || null
    }
    if (host === `${bucket.toLowerCase()}.storage.googleapis.com`) return pathname || null

    const configuredBase = String(config.assets.public_base_url || '').replace(/\/+$/, '')
    if (configuredBase && raw.startsWith(`${configuredBase}/`)) {
      return decodeURIComponent(raw.slice(configuredBase.length + 1)) || null
    }
  } catch {
    return null
  }
  return null
}

// ─── Signed URL (presign) ─────────────────────────────────────────────────────

const presign = async (
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE',
  key: string,
  expiresInSeconds = config.assets.signed_url_ttl_seconds,
  contentType?: string,
): Promise<string> => {
  assertConfigured()
  const action = (
    method === 'PUT' ? 'write' :
    method === 'DELETE' ? 'delete' :
    'read'
  ) as GetSignedUrlConfig['action']

  const options: GetSignedUrlConfig = {
    version: 'v4',
    action,
    expires: Date.now() + expiresInSeconds * 1000,
    ...(method === 'PUT' && contentType ? { contentType } : {}),
  }

  try {
    const [url] = await gcs().bucket(bucketName()).file(key).getSignedUrl(options)
    return url
  } catch (error: any) {
    throw unavailableError('Could not generate upload URL from Google Cloud Storage', {
      operation: method,
      reason: String(error?.message || 'gcs_signing_failed').slice(0, 200),
    })
  }
}

// ─── Public API — matches the shape expected by websiteBuilder.service.ts ─────

const presignUpload = (key: string, contentType?: string) => {
  assertConfigured()
  // Return synchronously using a deferred-resolve pattern so callers that
  // currently use the result synchronously still work. The actual GCS signed
  // URL is generated when the upload URL is first awaited / used.
  // For callers that need the URL immediately (websiteBuilder passes it back
  // to the browser), we return a thunk-based object. However, the existing
  // callers destructure `{ uploadUrl, key, publicUrl }` — all synchronous
  // fields. We keep those and add an async `getUploadUrl()`.
  const pub = publicUrl(key)
  return {
    key,
    publicUrl: pub,
    // Legacy sync field — kept for callers that read it without awaiting.
    // Will be an empty string for GCS (signed URL requires async signing).
    uploadUrl: '',
    // Callers should prefer this.
    getUploadUrl: () => presign('PUT', key, config.assets.signed_url_ttl_seconds, contentType),
    expiresIn: config.assets.signed_url_ttl_seconds,
  }
}

const presignDownload = (key: string, expiresInSeconds = 120) =>
  presign('GET', key, expiresInSeconds)

// ─── Direct server-side operations ───────────────────────────────────────────

const putBuffer = async (key: string, body: Buffer, contentType: string): Promise<void> => {
  assertConfigured()
  try {
    const file = gcs().bucket(bucketName()).file(key)
    await file.save(body, {
      contentType,
      resumable: false,
      metadata: { contentType },
    })
  } catch (error: any) {
    if (error instanceof ApiError) throw error
    throw unavailableError('Google Cloud Storage upload failed', {
      operation: 'put',
      reason: String(error?.message || 'gcs_write_failed').slice(0, 200),
    })
  }
}

const head = async (key: string) => {
  assertConfigured()
  try {
    const [metadata] = await gcs().bucket(bucketName()).file(key).getMetadata()
    return {
      size: Number(metadata.size || 0),
      contentType: String(metadata.contentType || 'application/octet-stream'),
      etag: String(metadata.etag || '').replace(/"/g, ''),
    }
  } catch (error: any) {
    if (error instanceof ApiError) throw error
    const code = error?.code ?? error?.response?.status
    if (code === 404) throw new ApiError(409, 'Uploaded object is not available (404)')
    if (code === 403 || code === 401) throw unavailableError('Google Cloud Storage rejected the request', { operation: 'head', status: code })
    throw unavailableError('Google Cloud Storage could not be reached', {
      operation: 'head',
      reason: String(error?.message || 'gcs_head_failed').slice(0, 200),
    })
  }
}

const remove = async (key: string): Promise<void> => {
  assertConfigured()
  try {
    await gcs().bucket(bucketName()).file(key).delete({ ignoreNotFound: true })
  } catch (error: any) {
    if (error instanceof ApiError) throw error
    throw unavailableError('Google Cloud Storage delete failed', {
      operation: 'delete',
      reason: String(error?.message || 'gcs_delete_failed').slice(0, 200),
    })
  }
}


const exists = async (key: string): Promise<boolean> => {
  assertConfigured()
  try {
    const [present] = await gcs().bucket(bucketName()).file(key).exists()
    return Boolean(present)
  } catch (error: any) {
    if (error instanceof ApiError) throw error
    throw unavailableError('Google Cloud Storage object existence check failed', {
      operation: 'exists',
      reason: String(error?.message || 'gcs_exists_failed').slice(0, 200),
    })
  }
}

/** Delete every object below a tenant-owned prefix. Idempotent by design. */
const removePrefix = async (prefix: string): Promise<void> => {
  assertConfigured()
  const normalized = String(prefix || '').replace(/^\/+/, '')
  if (!normalized) throw new ApiError(400, 'Storage deletion prefix is required')
  try {
    await gcs().bucket(bucketName()).deleteFiles({ prefix: normalized, force: true })
  } catch (error: any) {
    if (error instanceof ApiError) throw error
    throw unavailableError('Google Cloud Storage prefix deletion failed', {
      operation: 'delete_prefix',
      prefix: normalized,
      reason: String(error?.message || 'gcs_prefix_delete_failed').slice(0, 200),
    })
  }
}

const prefixHasObjects = async (prefix: string): Promise<boolean> => {
  assertConfigured()
  const normalized = String(prefix || '').replace(/^\/+/, '')
  if (!normalized) return false
  try {
    const [files] = await gcs().bucket(bucketName()).getFiles({ prefix: normalized, maxResults: 1, autoPaginate: false })
    return files.length > 0
  } catch (error: any) {
    if (error instanceof ApiError) throw error
    throw unavailableError('Google Cloud Storage prefix verification failed', {
      operation: 'verify_prefix',
      prefix: normalized,
      reason: String(error?.message || 'gcs_prefix_verify_failed').slice(0, 200),
    })
  }
}

// ─── CORS health (GCS supports CORS via bucket metadata, not OPTIONS preflight ─

const browserCorsHealth = async () => {
  assertConfigured()
  try {
    const [meta] = await gcs().bucket(bucketName()).getMetadata()
    const cors: any[] = meta.cors || []
    const origin = config.assets.browser_origin
    const originAllowed = cors.some((rule: any) =>
      Array.isArray(rule.origin) && (rule.origin.includes('*') || rule.origin.includes(origin))
    )
    const methodsNeeded = ['PUT', 'GET', 'HEAD']
    const methodsAllowed = cors.some((rule: any) =>
      Array.isArray(rule.method) && methodsNeeded.every((m) => rule.method.includes(m) || rule.method.includes('*'))
    )
    const healthy = cors.length > 0 && originAllowed && methodsAllowed
    return {
      origin,
      requiredMethods: methodsNeeded,
      requiredHeaders: ['Content-Type'],
      healthy,
      corsRules: cors,
      detail: !cors.length ? 'no_cors_rules' : !originAllowed ? 'origin_not_in_cors' : !methodsAllowed ? 'methods_not_in_cors' : undefined,
    }
  } catch (error: any) {
    return {
      origin: config.assets.browser_origin,
      requiredMethods: ['PUT', 'GET', 'HEAD'],
      requiredHeaders: ['Content-Type'],
      healthy: false,
      detail: String(error?.message || 'cors_check_failed').slice(0, 200),
    }
  }
}

// ─── Health check ─────────────────────────────────────────────────────────────

type StorageHealth = {
  provider: 'gcs'
  configured: boolean
  healthy: boolean
  latencyMs: number
  projectId?: string
  detail?: string
  missing?: string[]
  bucket?: string
  browserCors?: Awaited<ReturnType<typeof browserCorsHealth>>
}

let lastHealth: { at: number; value: StorageHealth } | null = null

const health = async (): Promise<StorageHealth> => {
  const configuration = configurationStatus()
  if (!configuration.configured) {
    return { provider: 'gcs', configured: false, healthy: false, latencyMs: 0, detail: 'not_configured', missing: configuration.missing, projectId: configuration.projectId, bucket: configuration.bucket }
  }
  const now = Date.now()
  if (lastHealth && now - lastHealth.at < config.assets.health_cache_ms) return lastHealth.value
  const started = performance.now()
  try {
    const [exists] = await gcs().bucket(bucketName()).exists()
    const browserCors = await browserCorsHealth()
    const healthy = exists && browserCors.healthy
    const value: StorageHealth = {
      provider: 'gcs',
      configured: true,
      healthy,
      latencyMs: Math.round(performance.now() - started),
      projectId: configuration.projectId,
      bucket: bucketName(),
      browserCors,
      ...(!exists ? { detail: 'bucket_not_found' } : !browserCors.healthy ? { detail: 'browser_cors_misconfigured' } : {}),
    }
    lastHealth = { at: now, value }
    return value
  } catch (error: any) {
    const value: StorageHealth = {
      provider: 'gcs',
      configured: true,
      healthy: false,
      latencyMs: Math.round(performance.now() - started),
      projectId: configuration.projectId,
      bucket: bucketName(),
      detail: String(error?.message || 'gcs_unreachable').slice(0, 200),
    }
    lastHealth = { at: now, value }
    return value
  }
}

// ─── Exported service ─────────────────────────────────────────────────────────

export const ObjectStorageService = {
  configurationStatus,
  presignUpload,
  presignDownload,
  head,
  putBuffer,
  remove,
  removePrefix,
  prefixHasObjects,
  exists,
  keyFromReference,
  publicUrl,
  browserCorsHealth,
  health,
}
