import path from 'path'

export type GcsProtectionMode = 'off' | 'warn' | 'require'

export type DatabaseBackupConfig = {
  nodeEnv: string
  sourceDatabaseUrl: string
  backupDatabaseUrl: string
  sourceDatabaseName: string
  backupDatabasePrefix: string
  manifestDatabaseName: string
  cron: string
  timezone: string
  retentionDays: number
  minRecoveryPoints: number
  workDir: string
  processTimeoutMs: number
  lockStaleMs: number
  maxParallelCollections: number
  allowSameCluster: boolean
  gcsProtectionMode: GcsProtectionMode
  gcpProjectId: string
  gcpBucketName: string
  gcpKeyFile: string
}

const envBoolean = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  if (['1', 'true', 'yes'].includes(raw)) return true
  if (['0', 'false', 'no'].includes(raw)) return false
  throw new Error(`${name} must be true or false`)
}

const envInteger = (name: string, fallback: number, min: number, max: number): number => {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return parsed
}

const required = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for database backups`)
  return value
}

const parseDatabaseNameFromMongoUri = (uri: string): string => {
  const withoutQuery = uri.split('?')[0]
  const authorityAndPath = withoutQuery.replace(/^mongodb(?:\+srv)?:\/\//i, '')
  const slash = authorityAndPath.indexOf('/')
  const encoded = slash >= 0 ? authorityAndPath.slice(slash + 1) : ''
  const name = decodeURIComponent(encoded).trim()
  if (!name) {
    throw new Error('DATABASE_URL must include the application database name or BACKUP_SOURCE_DATABASE_NAME must be set')
  }
  return name
}

const validateDatabaseName = (name: string, label: string): string => {
  const value = name.trim()
  if (!value || value.length > 63 || /[\\/\.\s"$*<>:|?\0]/.test(value)) {
    throw new Error(`${label} is not a safe MongoDB database name`)
  }
  return value
}

const validatePrefix = (value: string): string => {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9_-]{1,38}$/.test(normalized)) {
    throw new Error('BACKUP_DATABASE_PREFIX must contain only letters, numbers, underscore or hyphen and be at most 38 characters')
  }
  return normalized
}

const validateTimezone = (value: string): string => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date())
    return value
  } catch {
    throw new Error(`BACKUP_TIMEZONE is not a valid IANA timezone: ${value}`)
  }
}

const parseGcsProtectionMode = (): GcsProtectionMode => {
  const raw = (process.env.BACKUP_GCS_PROTECTION_MODE || 'warn').trim().toLowerCase()
  if (!['off', 'warn', 'require'].includes(raw)) {
    throw new Error('BACKUP_GCS_PROTECTION_MODE must be one of: off, warn, require')
  }
  return raw as GcsProtectionMode
}

export const mongoClusterIdentity = (uri: string): string => {
  const withoutScheme = uri.replace(/^mongodb(?:\+srv)?:\/\//i, '')
  const authority = withoutScheme.split('/')[0]?.split('?')[0] || ''
  const hosts = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority
  return hosts
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',')
}

export const loadDatabaseBackupConfig = (): DatabaseBackupConfig => {
  const sourceDatabaseUrl = required('DATABASE_URL')
  const backupDatabaseUrl = required('BACKUP_DATABASE_URL')
  const sourceDatabaseName = validateDatabaseName(
    process.env.BACKUP_SOURCE_DATABASE_NAME?.trim() || parseDatabaseNameFromMongoUri(sourceDatabaseUrl),
    'BACKUP_SOURCE_DATABASE_NAME',
  )
  const backupDatabasePrefix = validatePrefix(process.env.BACKUP_DATABASE_PREFIX || 'real_estate_saas_backup')
  const manifestDatabaseName = validateDatabaseName(
    process.env.BACKUP_MANIFEST_DATABASE_NAME || `${backupDatabasePrefix}_control`,
    'BACKUP_MANIFEST_DATABASE_NAME',
  )
  const nodeEnv = process.env.NODE_ENV || 'development'
  const allowSameCluster = envBoolean('BACKUP_ALLOW_SAME_CLUSTER', false)
  const sourceCluster = mongoClusterIdentity(sourceDatabaseUrl)
  const backupCluster = mongoClusterIdentity(backupDatabaseUrl)

  if (!sourceCluster || !backupCluster) throw new Error('Could not determine MongoDB source/backup cluster identity')
  if (sourceCluster === backupCluster && (nodeEnv === 'production' || !allowSameCluster)) {
    throw new Error('BACKUP_DATABASE_URL must point to a different MongoDB cluster in production')
  }

  return {
    nodeEnv,
    sourceDatabaseUrl,
    backupDatabaseUrl,
    sourceDatabaseName,
    backupDatabasePrefix,
    manifestDatabaseName,
    cron: (process.env.BACKUP_CRON || '15 3 * * *').trim(),
    timezone: validateTimezone((process.env.BACKUP_TIMEZONE || 'Asia/Dhaka').trim()),
    retentionDays: envInteger('BACKUP_RETENTION_DAYS', 30, 7, 3650),
    minRecoveryPoints: envInteger('BACKUP_MIN_RECOVERY_POINTS', 7, 1, 365),
    workDir: path.resolve(process.env.BACKUP_WORK_DIR || '/tmp/real-estate-db-backup'),
    processTimeoutMs: envInteger('BACKUP_PROCESS_TIMEOUT_MINUTES', 120, 5, 720) * 60_000,
    lockStaleMs: envInteger('BACKUP_LOCK_STALE_MINUTES', 360, 30, 2880) * 60_000,
    maxParallelCollections: envInteger('BACKUP_MAX_PARALLEL_COLLECTIONS', 4, 1, 16),
    allowSameCluster,
    gcsProtectionMode: parseGcsProtectionMode(),
    gcpProjectId: process.env.GCP_PROJECT_ID?.trim() || process.env.PROJECTS_ID?.trim() || '',
    gcpBucketName: process.env.GCP_BUCKET_NAME?.trim() || process.env.BUCKET_NAME?.trim() || '',
    gcpKeyFile: process.env.GCP_KEY_FILE?.trim() || process.env.KEYFILENAME?.trim() || '',
  }
}
