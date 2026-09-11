import fs from 'node:fs'
import path from 'node:path'

export const fail = (message, exitCode = 1) => {
  console.error(`[storage-migration] ${message}`)
  process.exit(exitCode)
}

export const arg = (name, fallback = '') => {
  const prefix = `--${name}=`
  const entry = process.argv.find((value) => value.startsWith(prefix))
  return entry ? entry.slice(prefix.length) : fallback
}

export const hasFlag = (name) => process.argv.includes(`--${name}`)

export const intArg = (name, fallback, min, max) => {
  const raw = Number(arg(name, String(fallback)))
  if (!Number.isFinite(raw)) fail(`--${name} must be a number`)
  return Math.max(min, Math.min(max, Math.trunc(raw)))
}

export const ensureDirectory = (directory) => {
  fs.mkdirSync(directory, { recursive: true })
  return directory
}

export const timestampSlug = () => new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')

export const writeJson = (filePath, value) => {
  ensureDirectory(path.dirname(filePath))
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

export const appendJsonLine = (filePath, value) => {
  ensureDirectory(path.dirname(filePath))
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, { mode: 0o600 })
}

export const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))

export const normalizeBucketName = (value) => String(value || '').trim()

export const migrationBuckets = () => {
  const gcsPublic = normalizeBucketName(process.env.GCS_MIGRATION_PUBLIC_BUCKET_NAME)
  const gcsPrivate = normalizeBucketName(process.env.GCS_MIGRATION_PRIVATE_BUCKET_NAME)
  const r2Public = normalizeBucketName(process.env.R2_PUBLIC_BUCKET_NAME)
  const r2Private = normalizeBucketName(process.env.R2_PRIVATE_BUCKET_NAME)
  return { gcsPublic, gcsPrivate, r2Public, r2Private }
}

export const requireMigrationBuckets = () => {
  const buckets = migrationBuckets()
  const missing = Object.entries(buckets).filter(([, value]) => !value).map(([key]) => key)
  if (missing.length) fail(`Missing migration bucket configuration: ${missing.join(', ')}`)
  if (buckets.r2Public === buckets.r2Private) fail('R2 public and private bucket names must be different')
  return buckets
}

const normalizePrivateKey = (value) => String(value || '').replace(/\\n/g, '\n').trim()

export const loadGcsServiceAccount = () => {
  const rawJson = String(process.env.GCS_MIGRATION_SERVICE_ACCOUNT_JSON || '').trim()
  const filePath = String(process.env.GCS_MIGRATION_SERVICE_ACCOUNT_FILE || '').trim()
  let parsed

  if (rawJson) {
    try {
      parsed = JSON.parse(rawJson)
    } catch {
      fail('GCS_MIGRATION_SERVICE_ACCOUNT_JSON is not valid JSON')
    }
  } else if (filePath) {
    const resolved = path.resolve(filePath)
    if (!fs.existsSync(resolved)) fail(`GCS migration service-account file does not exist: ${resolved}`)
    try {
      parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'))
    } catch {
      fail(`Could not parse GCS migration service-account JSON: ${resolved}`)
    }
  } else {
    fail('Set GCS_MIGRATION_SERVICE_ACCOUNT_FILE or GCS_MIGRATION_SERVICE_ACCOUNT_JSON')
  }

  const clientEmail = String(parsed?.client_email || '').trim()
  const privateKey = normalizePrivateKey(parsed?.private_key)
  const projectId = String(parsed?.project_id || '').trim()
  if (!clientEmail || !privateKey) fail('GCS migration service account must contain client_email and private_key')
  return { clientEmail, privateKey, projectId }
}

export const parseGcsReference = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return null

  if (raw.startsWith('gs://')) {
    const withoutScheme = raw.slice(5)
    const slash = withoutScheme.indexOf('/')
    if (slash <= 0) return null
    return { bucket: withoutScheme.slice(0, slash), key: decodeURIComponent(withoutScheme.slice(slash + 1)) }
  }

  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null

  const host = parsed.hostname.toLowerCase()
  const pathValue = parsed.pathname.replace(/^\/+/, '')
  if (host === 'storage.googleapis.com') {
    const slash = pathValue.indexOf('/')
    if (slash <= 0) return null
    return {
      bucket: decodeURIComponent(pathValue.slice(0, slash)),
      key: decodeURIComponent(pathValue.slice(slash + 1)),
    }
  }

  const suffix = '.storage.googleapis.com'
  if (host.endsWith(suffix)) {
    const bucket = host.slice(0, -suffix.length)
    if (!bucket || !pathValue) return null
    return { bucket, key: decodeURIComponent(pathValue) }
  }

  return null
}

export const isPrivateObjectKey = (key) => {
  const value = String(key || '').replace(/^\/+/, '')
  return /^support\//.test(value)
    || /^tenants\/[^/]+\/properties\/documents\//.test(value)
    || /^tenants\/[^/]+\/suppliers\/invoices\//.test(value)
    || /^tenants\/[^/]+\/upload-staging\//.test(value)
}

export const tenantFromKey = (key) => {
  const value = String(key || '').replace(/^\/+/, '')
  const tenant = value.match(/^tenants\/([^/]+)\//)?.[1]
  if (tenant) return tenant
  return value.match(/^support\/([^/]+)\//)?.[1] || ''
}

export const encodeStoragePath = (key) => String(key || '')
  .replace(/^\/+/, '')
  .split('/')
  .filter(Boolean)
  .map((segment) => encodeURIComponent(segment))
  .join('/')

export const canonicalR2PublicUrl = (key) => {
  const base = String(process.env.OBJECT_STORAGE_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
  if (!base) fail('OBJECT_STORAGE_PUBLIC_BASE_URL is required to rewrite public GCS references')
  return `${base}/${encodeStoragePath(key)}`
}

export const selectedScopes = () => {
  const scope = arg('scope', 'all').trim().toLowerCase()
  if (!['all', 'public', 'private'].includes(scope)) fail('--scope must be one of: all, public, private')
  return scope === 'all' ? ['public', 'private'] : [scope]
}

const privateKeyBlockPattern = new RegExp(
  `-----BEGIN ${'PRIVATE'} KEY-----[\\s\\S]*?-----END ${'PRIVATE'} KEY-----`,
  'g',
)

export const redactError = (error) => {
  const message = String(error?.message || error || 'unknown_error')
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(privateKeyBlockPattern, '[REDACTED_PRIVATE_KEY]')
    .slice(0, 1000)
}

export const mapWithConcurrency = async (items, concurrency, worker) => {
  const output = new Array(items.length)
  let cursor = 0
  const run = async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      output[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, () => run()))
  return output
}
