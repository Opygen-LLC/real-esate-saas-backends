import crypto from 'crypto'
import mongoose from 'mongoose'
import { DatabaseBackupService } from './databaseBackup.service'
import { loadDatabaseBackupConfig } from './databaseBackup.config'
import { logger } from '../../../shared/logger'

const confirmation = 'PHASE7-STAGING-DRILL'
const sampleLimit = Math.max(1, Math.min(20, Number(process.env.BACKUP_DRILL_SAMPLE_LIMIT || 3)))
const criticalCollections = (process.env.BACKUP_DRILL_CRITICAL_COLLECTIONS || 'organizations,users,properties,subscriptions,subscriptionpayments,websiteassets')
  .split(',').map((value) => value.trim()).filter(Boolean)

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object') {
    const raw = value as Record<string, unknown>
    if (typeof (raw as any).toHexString === 'function') return (raw as any).toHexString()
    return Object.fromEntries(Object.entries(raw).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]))
  }
  return value
}

const fingerprint = (value: unknown): string => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')

const main = async (): Promise<void> => {
  if (process.env.NODE_ENV === 'production') throw new Error('The staging recovery drill refuses NODE_ENV=production')
  if (process.env.BACKUP_DRILL_CONFIRM !== confirmation) throw new Error(`Set BACKUP_DRILL_CONFIRM=${confirmation} to run the destructive staging recovery drill`)
  if (process.env.BACKUP_DRILL_EXPECT_QUIESCENT !== 'true') throw new Error('Set BACKUP_DRILL_EXPECT_QUIESCENT=true only after staging writes are paused for strict critical-record comparison')

  const config = loadDatabaseBackupConfig()
  const manifest = await DatabaseBackupService.runOnce()
  if (manifest.status !== 'success' || !manifest.restoreVerification?.passed) throw new Error('Staging backup restore verification did not pass')

  const source = await mongoose.createConnection(config.sourceDatabaseUrl, { dbName: config.sourceDatabaseName, maxPoolSize: 2, minPoolSize: 0 }).asPromise()
  const restored = await mongoose.createConnection(config.backupDatabaseUrl, { dbName: manifest.backupDatabase, maxPoolSize: 2, minPoolSize: 0 }).asPromise()
  const checks: Array<{ collection: string; sampled: number; matched: number; passed: boolean }> = []
  try {
    if (!source.db || !restored.db) throw new Error('Staging drill database handles are unavailable')
    const restoredNames = new Set((await restored.db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name))
    for (const collectionName of criticalCollections) {
      if (!restoredNames.has(collectionName)) continue
      const samples = await restored.db.collection(collectionName).find({}).sort({ _id: 1 }).limit(sampleLimit).toArray()
      let matched = 0
      for (const restoredDoc of samples) {
        const sourceDoc = await source.db.collection(collectionName).findOne({ _id: restoredDoc._id })
        if (sourceDoc && fingerprint(sourceDoc) === fingerprint(restoredDoc)) matched += 1
      }
      checks.push({ collection: collectionName, sampled: samples.length, matched, passed: matched === samples.length })
    }
  } finally {
    await Promise.allSettled([source.close(), restored.close()])
  }

  if (!checks.length) throw new Error(`None of the configured critical collections were found: ${criticalCollections.join(', ')}`)
  if (checks.some((check) => !check.passed)) throw new Error(`Critical-record restore comparison failed: ${JSON.stringify(checks)}`)

  const result = {
    schemaVersion: 1,
    runId: manifest.runId,
    backupDatabase: manifest.backupDatabase,
    verifiedAt: new Date().toISOString(),
    restoreVerificationPassed: true,
    criticalRecordChecks: checks,
  }
  const control = await mongoose.createConnection(config.backupDatabaseUrl, {
    dbName: config.manifestDatabaseName,
    maxPoolSize: 1,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 15_000,
  }).asPromise()
  try {
    if (!control.db) throw new Error('Backup control database handle is unavailable')
    await control.db.collection('database_backup_drills').updateOne(
      { runId: manifest.runId },
      { $set: result },
      { upsert: true },
    )
    await control.db.collection('database_backup_drills').createIndex({ verifiedAt: -1 })
  } finally {
    await control.close()
  }
  logger.info('phase7_staging_recovery_drill_passed', result)
}

void main().catch((error) => {
  logger.error('phase7_staging_recovery_drill_failed', { error })
  process.exitCode = 1
})
