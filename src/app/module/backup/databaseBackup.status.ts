import mongoose from 'mongoose'
import type { DatabaseBackupConfig } from './databaseBackup.config'

const OPERATION_STATUS_COLLECTION = 'platform_operation_status'
const DATABASE_BACKUP_STATUS_ID = 'database_backup'

export type DatabaseBackupOperationStatus = {
  _id: string
  status: 'never_run' | 'running' | 'success' | 'failed'
  runId?: string
  backupDatabase?: string
  startedAt?: string
  finishedAt?: string
  lastDatabaseBackupAt?: string
  lastDurationMs?: number
  restoreVerified?: boolean
  lastError?: string
  updatedAt: string
}

const withSourceConnection = async <T>(config: DatabaseBackupConfig, work: (db: NonNullable<typeof mongoose.connection.db>) => Promise<T>): Promise<T> => {
  const connection = await mongoose.createConnection(config.sourceDatabaseUrl, {
    dbName: config.sourceDatabaseName,
    maxPoolSize: 2,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 15_000,
  }).asPromise()
  try {
    if (!connection.db) throw new Error('Primary operation-status database handle is unavailable')
    return await work(connection.db)
  } finally {
    await connection.close()
  }
}

const write = async (config: DatabaseBackupConfig, update: Record<string, unknown>): Promise<void> => {
  await withSourceConnection(config, async (db) => {
    await db.collection<any>(OPERATION_STATUS_COLLECTION).updateOne(
      { _id: DATABASE_BACKUP_STATUS_ID },
      { $set: { ...update, updatedAt: new Date().toISOString() } },
      { upsert: true },
    )
  })
}

const markStarted = async (config: DatabaseBackupConfig, input: { runId: string; backupDatabase: string; startedAt: string }): Promise<void> => {
  await write(config, {
    status: 'running',
    runId: input.runId,
    backupDatabase: input.backupDatabase,
    startedAt: input.startedAt,
    finishedAt: null,
    restoreVerified: false,
    lastError: '',
  })
}

const markSuccess = async (config: DatabaseBackupConfig, input: { runId: string; backupDatabase: string; startedAt: string; finishedAt: string; restoreVerified: boolean }): Promise<void> => {
  const duration = Math.max(0, new Date(input.finishedAt).getTime() - new Date(input.startedAt).getTime())
  await write(config, {
    status: 'success',
    runId: input.runId,
    backupDatabase: input.backupDatabase,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    lastDatabaseBackupAt: input.finishedAt,
    lastDurationMs: duration,
    restoreVerified: input.restoreVerified,
    lastError: '',
  })
}

const markFailed = async (config: DatabaseBackupConfig, input: { runId: string; backupDatabase: string; startedAt: string; finishedAt: string; error: string }): Promise<void> => {
  const duration = Math.max(0, new Date(input.finishedAt).getTime() - new Date(input.startedAt).getTime())
  await write(config, {
    status: 'failed',
    runId: input.runId,
    backupDatabase: input.backupDatabase,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    lastDurationMs: duration,
    restoreVerified: false,
    lastError: input.error.slice(0, 500),
  })
}

const readCurrent = async (): Promise<DatabaseBackupOperationStatus> => {
  if (!mongoose.connection.db || mongoose.connection.readyState !== 1) {
    return { _id: DATABASE_BACKUP_STATUS_ID, status: 'never_run', updatedAt: '' }
  }
  const value = await mongoose.connection.db.collection<any>(OPERATION_STATUS_COLLECTION).findOne({ _id: DATABASE_BACKUP_STATUS_ID })
  if (!value) return { _id: DATABASE_BACKUP_STATUS_ID, status: 'never_run', updatedAt: '' }
  return {
    _id: DATABASE_BACKUP_STATUS_ID,
    status: ['running', 'success', 'failed'].includes(value.status) ? value.status : 'never_run',
    runId: value.runId,
    backupDatabase: value.backupDatabase,
    startedAt: value.startedAt,
    finishedAt: value.finishedAt,
    lastDatabaseBackupAt: value.lastDatabaseBackupAt,
    lastDurationMs: Number.isFinite(Number(value.lastDurationMs)) ? Number(value.lastDurationMs) : undefined,
    restoreVerified: typeof value.restoreVerified === 'boolean' ? value.restoreVerified : undefined,
    lastError: typeof value.lastError === 'string' ? value.lastError.slice(0, 500) : undefined,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
  }
}

export const DatabaseBackupStatusStore = { markStarted, markSuccess, markFailed, readCurrent }
