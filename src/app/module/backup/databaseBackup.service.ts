import crypto from 'crypto'
import fs, { FileHandle } from 'fs/promises'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import mongoose from 'mongoose'
import { Storage } from '@google-cloud/storage'
import { logger } from '../../../shared/logger'
import { DatabaseBackupConfig, loadDatabaseBackupConfig } from './databaseBackup.config'
import { DatabaseBackupStatusStore } from './databaseBackup.status'
import {
  BackupCollectionInventory,
  BackupCollectionVerification,
  DatabaseBackupManifest,
  GcsProtectionResult,
  RestoreVerificationResult,
} from './databaseBackup.types'

const MANIFEST_COLLECTION = 'database_backups'
const TOOL_OUTPUT_LIMIT = 64 * 1024

const safeErrorMessage = (value: unknown): string => {
  const raw = value instanceof Error ? value.message : String(value)
  return raw
    .replace(/mongodb(\+srv)?:\/\/[^@\s]+@/gi, 'mongodb$1://[redacted]@')
    .replace(/(password|secret|token)=([^&\s]+)/gi, '$1=[redacted]')
    .slice(0, 4000)
}

const safeJson = (value: unknown): string => {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize)
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, normalize(entry)]),
      )
    }
    return item
  }
  return JSON.stringify(normalize(value))
}

const localTimestampParts = (date: Date, timeZone: string): Record<string, string> => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
}

const buildBackupDatabaseName = (prefix: string, date: Date, timeZone: string): string => {
  const p = localTimestampParts(date, timeZone)
  return `${prefix}_${p.year}_${p.month}_${p.day}_${p.hour}${p.minute}${p.second}`
}

const runWithConcurrency = async <T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

const secureToolConfig = async (dir: string, name: string, uri: string): Promise<string> => {
  const file = path.join(dir, `${name}.mongo-tools.yml`)
  await fs.writeFile(file, `uri: ${JSON.stringify(uri)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  return file
}

type CommandResult = { stdout: string; stderr: string }

const runCommand = async (
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandResult> => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LC_ALL: 'C' },
  })
  let stdout = ''
  let stderr = ''
  let settled = false
  const append = (current: string, chunk: Buffer): string => `${current}${chunk.toString('utf8')}`.slice(-TOOL_OUTPUT_LIMIT)
  child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
  child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })

  const timeout = setTimeout(() => {
    if (settled) return
    child.kill('SIGTERM')
    setTimeout(() => child.kill('SIGKILL'), 5_000).unref()
  }, timeoutMs)
  timeout.unref()

  child.once('error', (error) => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    reject(error)
  })
  child.once('exit', (code, signal) => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    if (code === 0) return resolve({ stdout, stderr })
    const detail = safeErrorMessage(stderr || stdout || `signal=${signal || 'none'}`)
    reject(new Error(`${command} failed with exit code ${code ?? 'null'}: ${detail}`))
  })
})


type StreamTransferResult = {
  archiveBytes: number
  archiveSha256: string
  dumpStderr: string
  restoreStdout: string
  restoreStderr: string
}

const streamDumpToRestore = async (
  sourceConfigFile: string,
  backupConfigFile: string,
  sourceDatabaseName: string,
  backupDatabase: string,
  maxParallelCollections: number,
  timeoutMs: number,
): Promise<StreamTransferResult> => new Promise((resolve, reject) => {
  const dump = spawn('mongodump', [
    `--config=${sourceConfigFile}`,
    `--db=${sourceDatabaseName}`,
    '--archive',
    '--gzip',
    `--numParallelCollections=${maxParallelCollections}`,
  ], {
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LC_ALL: 'C' },
  })
  const restore = spawn('mongorestore', [
    `--config=${backupConfigFile}`,
    '--archive',
    '--gzip',
    `--nsFrom=${sourceDatabaseName}.*`,
    `--nsTo=${backupDatabase}.*`,
    '--drop',
    '--stopOnError',
  ], {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, LC_ALL: 'C' },
  })

  const hash = crypto.createHash('sha256')
  let archiveBytes = 0
  let dumpStderr = ''
  let restoreStdout = ''
  let restoreStderr = ''
  let dumpExit: { code: number | null; signal: NodeJS.Signals | null } | null = null
  let restoreExit: { code: number | null; signal: NodeJS.Signals | null } | null = null
  let settled = false

  const append = (current: string, chunk: Buffer): string => `${current}${chunk.toString('utf8')}`.slice(-TOOL_OUTPUT_LIMIT)
  dump.stderr.on('data', (chunk: Buffer) => { dumpStderr = append(dumpStderr, chunk) })
  restore.stdout.on('data', (chunk: Buffer) => { restoreStdout = append(restoreStdout, chunk) })
  restore.stderr.on('data', (chunk: Buffer) => { restoreStderr = append(restoreStderr, chunk) })

  dump.stdout.on('data', (chunk: Buffer) => {
    archiveBytes += chunk.length
    hash.update(chunk)
  })
  dump.stdout.pipe(restore.stdin)
  restore.stdin.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE' && !settled) {
      dump.kill('SIGTERM')
      restore.kill('SIGTERM')
    }
  })

  const terminate = (): void => {
    dump.kill('SIGTERM')
    restore.kill('SIGTERM')
    setTimeout(() => {
      dump.kill('SIGKILL')
      restore.kill('SIGKILL')
    }, 5_000).unref()
  }

  const timeout = setTimeout(() => {
    if (!settled) terminate()
  }, timeoutMs)
  timeout.unref()

  const fail = (message: string): void => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    terminate()
    reject(new Error(message))
  }

  const maybeFinish = (): void => {
    if (settled || !dumpExit || !restoreExit) return
    if (dumpExit.code !== 0 || restoreExit.code !== 0) {
      const detail = safeErrorMessage(
        restoreStderr || dumpStderr ||
        `mongodump exit=${dumpExit.code ?? 'null'} signal=${dumpExit.signal || 'none'}; ` +
        `mongorestore exit=${restoreExit.code ?? 'null'} signal=${restoreExit.signal || 'none'}`,
      )
      return fail(`Atlas-to-Atlas backup stream failed: ${detail}`)
    }
    if (archiveBytes <= 0) {
      return fail('Atlas-to-Atlas backup stream produced zero archive bytes')
    }
    settled = true
    clearTimeout(timeout)
    resolve({
      archiveBytes,
      archiveSha256: hash.digest('hex'),
      dumpStderr,
      restoreStdout,
      restoreStderr,
    })
  }

  dump.once('error', (error) => fail(`mongodump could not start: ${safeErrorMessage(error)}`))
  restore.once('error', (error) => fail(`mongorestore could not start: ${safeErrorMessage(error)}`))
  dump.once('exit', (code, signal) => {
    dumpExit = { code, signal }
    maybeFinish()
  })
  restore.once('exit', (code, signal) => {
    restoreExit = { code, signal }
    if (code !== 0 && dumpExit === null) dump.kill('SIGTERM')
    maybeFinish()
  })
})

const toolVersion = async (command: string, timeoutMs: number): Promise<string> => {
  const result = await runCommand(command, ['--version'], Math.min(timeoutMs, 30_000))
  return (result.stdout || result.stderr).trim().split('\n')[0]?.slice(0, 200) || 'unknown'
}


const normalizeIndex = (index: Record<string, unknown>): string => safeJson({
  name: index.name,
  key: index.key,
  unique: index.unique || false,
  sparse: index.sparse || false,
  expireAfterSeconds: index.expireAfterSeconds ?? null,
  partialFilterExpression: index.partialFilterExpression ?? null,
  collation: index.collation ?? null,
  wildcardProjection: index.wildcardProjection ?? null,
})

const normalizeCollectionOptions = (options: Record<string, unknown> | undefined): string => safeJson({
  capped: options?.capped || false,
  size: options?.size ?? null,
  max: options?.max ?? null,
  validator: options?.validator ?? null,
  validationLevel: options?.validationLevel ?? null,
  validationAction: options?.validationAction ?? null,
  collation: options?.collation ?? null,
  timeseries: options?.timeseries ?? null,
  clusteredIndex: options?.clusteredIndex ?? null,
  viewOn: options?.viewOn ?? null,
  pipeline: options?.pipeline ?? null,
  changeStreamPreAndPostImages: options?.changeStreamPreAndPostImages ?? null,
  encryptedFields: options?.encryptedFields ?? null,
})

const inspectDatabase = async (
  uri: string,
  dbName: string,
  concurrency: number,
): Promise<BackupCollectionInventory[]> => {
  const connection = await mongoose.createConnection(uri, {
    dbName,
    maxPoolSize: Math.max(2, Math.min(concurrency + 1, 8)),
    minPoolSize: 0,
    serverSelectionTimeoutMS: 15_000,
    connectTimeoutMS: 15_000,
    socketTimeoutMS: 10 * 60_000,
  }).asPromise()
  try {
    if (!connection.db) throw new Error(`MongoDB database handle is unavailable for ${dbName}`)
    const entries = await connection.db.listCollections({}, { nameOnly: false }).toArray()
    const inventory = await runWithConcurrency(entries, concurrency, async (entry) => {
      const type = entry.type || 'collection'
      const collection = connection.db!.collection(entry.name)
      let documents: number | null = null
      let indexSignatures: string[] = []
      if (type !== 'view') {
        documents = await collection.countDocuments({}, { maxTimeMS: 10 * 60_000 })
        const indexes = await collection.indexes()
        indexSignatures = indexes.map((index) => normalizeIndex(index as unknown as Record<string, unknown>)).sort()
      }
      return {
        name: entry.name,
        type,
        documents,
        indexSignatures,
        optionsSignature: normalizeCollectionOptions(entry.options as Record<string, unknown> | undefined),
      } satisfies BackupCollectionInventory
    })
    return inventory.sort((a, b) => a.name.localeCompare(b.name))
  } finally {
    await connection.close()
  }
}

const inspectGcsProtection = async (config: DatabaseBackupConfig): Promise<GcsProtectionResult> => {
  if (config.gcsProtectionMode === 'off') {
    return { checked: false, protected: false, mode: 'off', message: 'GCS disaster-recovery protection check is disabled.' }
  }
  if (!config.gcpBucketName) {
    const result: GcsProtectionResult = {
      checked: false,
      protected: false,
      mode: config.gcsProtectionMode,
      message: 'GCP_BUCKET_NAME is not configured for the backup worker; media protection could not be verified.',
    }
    if (config.gcsProtectionMode === 'require') throw new Error(result.message)
    return result
  }

  try {
    const storage = new Storage({
      ...(config.gcpProjectId ? { projectId: config.gcpProjectId } : {}),
      ...(config.gcpKeyFile ? { keyFilename: config.gcpKeyFile } : {}),
    })
    const [metadata] = await storage.bucket(config.gcpBucketName).getMetadata()
    const raw = metadata as unknown as Record<string, any>
    const versioningEnabled = Boolean(raw.versioning?.enabled)
    const retentionSeconds = Number(raw.retentionPolicy?.retentionPeriod || 0)
    const softDeleteSeconds = Number(raw.softDeletePolicy?.retentionDurationSeconds || 0)
    const protectedBucket = versioningEnabled || retentionSeconds > 0 || softDeleteSeconds > 0
    const result: GcsProtectionResult = {
      checked: true,
      protected: protectedBucket,
      mode: config.gcsProtectionMode,
      bucket: config.gcpBucketName,
      versioningEnabled,
      retentionSeconds,
      softDeleteSeconds,
      message: protectedBucket
        ? 'GCS media protection is enabled.'
        : 'GCS bucket has no detected soft-delete retention, retention policy, or object versioning.',
    }
    if (!protectedBucket && config.gcsProtectionMode === 'require') throw new Error(result.message)
    return result
  } catch (error) {
    if (config.gcsProtectionMode === 'require') throw error
    return {
      checked: false,
      protected: false,
      mode: config.gcsProtectionMode,
      bucket: config.gcpBucketName,
      message: `GCS media protection verification failed: ${safeErrorMessage(error)}`,
    }
  }
}

const verifyRestore = (
  sourceBefore: BackupCollectionInventory[],
  sourceAfter: BackupCollectionInventory[],
  restored: BackupCollectionInventory[],
): RestoreVerificationResult => {
  const beforeMap = new Map(sourceBefore.map((entry) => [entry.name, entry]))
  const afterMap = new Map(sourceAfter.map((entry) => [entry.name, entry]))
  const restoredMap = new Map(restored.map((entry) => [entry.name, entry]))
  const missingCollections = sourceBefore.filter((entry) => !restoredMap.has(entry.name)).map((entry) => entry.name)
  const unexpectedCollections = restored.filter((entry) => !beforeMap.has(entry.name)).map((entry) => entry.name)
  const collections: BackupCollectionVerification[] = sourceBefore.map((before) => {
    const after = afterMap.get(before.name) || before
    const target = restoredMap.get(before.name)
    const numericCounts = [before.documents, after.documents].filter((value): value is number => typeof value === 'number')
    const low = numericCounts.length ? Math.min(...numericCounts) : null
    const high = numericCounts.length ? Math.max(...numericCounts) : null
    const restoredCount = target?.documents ?? null
    const countWithinObservedRange = low === null || high === null || restoredCount === null
      ? restoredCount === before.documents
      : restoredCount >= low && restoredCount <= high
    return {
      name: before.name,
      sourceDocumentsBefore: before.documents,
      sourceDocumentsAfter: after.documents,
      restoredDocuments: restoredCount,
      countWithinObservedRange,
      indexesMatch: target ? safeJson(target.indexSignatures) === safeJson(before.indexSignatures) : false,
      optionsMatch: target ? target.optionsSignature === before.optionsSignature : false,
    }
  })
  const sourceTotalBefore = sourceBefore.reduce((sum, entry) => sum + (entry.documents || 0), 0)
  const sourceTotalAfter = sourceAfter.reduce((sum, entry) => sum + (entry.documents || 0), 0)
  const restoredTotal = restored.reduce((sum, entry) => sum + (entry.documents || 0), 0)
  const passed = missingCollections.length === 0
    && collections.every((entry) => entry.countWithinObservedRange && entry.indexesMatch && entry.optionsMatch)
  return {
    passed,
    verifiedAt: new Date().toISOString(),
    missingCollections,
    unexpectedCollections,
    collections,
    sourceTotalBefore,
    sourceTotalAfter,
    restoredTotal,
  }
}


const persistRemoteManifest = async (config: DatabaseBackupConfig, manifest: DatabaseBackupManifest): Promise<void> => {
  const connection = await mongoose.createConnection(config.backupDatabaseUrl, {
    dbName: config.manifestDatabaseName,
    maxPoolSize: 2,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 15_000,
  }).asPromise()
  try {
    if (!connection.db) throw new Error('Backup manifest database handle is unavailable')
    await connection.db.collection(MANIFEST_COLLECTION).updateOne(
      { runId: manifest.runId },
      { $set: manifest },
      { upsert: true },
    )
    await connection.db.collection(MANIFEST_COLLECTION).createIndex({ startedAt: -1 })
    await connection.db.collection(MANIFEST_COLLECTION).createIndex({ backupDatabase: 1 }, { unique: true })
  } finally {
    await connection.close()
  }
}


const runRetention = async (
  config: DatabaseBackupConfig,
  currentBackupDatabase: string,
): Promise<NonNullable<DatabaseBackupManifest['retention']>> => {
  const deletedBackupDatabases: string[] = []
  const deletedArchiveFiles: string[] = []
  const connection = await mongoose.createConnection(config.backupDatabaseUrl, {
    dbName: config.manifestDatabaseName,
    maxPoolSize: 2,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 15_000,
  }).asPromise()
  try {
    if (!connection.db) throw new Error('Backup manifest database handle is unavailable')
    const manifests = await connection.db.collection<DatabaseBackupManifest>(MANIFEST_COLLECTION)
      .find({ status: 'success', retentionDeletedAt: { $exists: false } })
      .sort({ startedAt: -1 })
      .toArray()
    const cutoff = Date.now() - config.retentionDays * 24 * 60 * 60_000
    const candidates = manifests.filter((manifest, index) => {
      if (index < config.minRecoveryPoints) return false
      if (manifest.backupDatabase === currentBackupDatabase) return false
      return new Date(manifest.startedAt).getTime() < cutoff
    })

    for (const candidate of candidates) {
      if (candidate.backupDatabase === config.manifestDatabaseName || candidate.backupDatabase === config.sourceDatabaseName) continue
      const backupConnection = await mongoose.createConnection(config.backupDatabaseUrl, {
        dbName: candidate.backupDatabase,
        maxPoolSize: 1,
        minPoolSize: 0,
        serverSelectionTimeoutMS: 15_000,
      }).asPromise()
      try {
        if (backupConnection.db) await backupConnection.db.dropDatabase()
      } finally {
        await backupConnection.close()
      }
      deletedBackupDatabases.push(candidate.backupDatabase)
      await connection.db.collection(MANIFEST_COLLECTION).updateOne(
        { runId: candidate.runId },
        { $set: { retentionDeletedAt: new Date().toISOString() } },
      )
    }
  } finally {
    await connection.close()
  }
  return {
    retentionDays: config.retentionDays,
    minRecoveryPoints: config.minRecoveryPoints,
    deletedBackupDatabases,
    deletedArchiveFiles,
  }
}

const acquireLock = async (config: DatabaseBackupConfig): Promise<() => Promise<void>> => {
  await fs.mkdir(config.workDir, { recursive: true, mode: 0o700 })
  const lockFile = path.join(config.workDir, '.database-backup.lock')
  try {
    const stat = await fs.stat(lockFile)
    if (Date.now() - stat.mtimeMs > config.lockStaleMs) await fs.unlink(lockFile)
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
  }
  let handle: FileHandle
  try {
    handle = await fs.open(lockFile, 'wx', 0o600)
  } catch (error: any) {
    if (error?.code === 'EEXIST') throw new Error('A database backup is already running')
    throw error
  }
  await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`)
  await handle.close()
  return async () => { await fs.unlink(lockFile).catch(() => undefined) }
}


const assertBackupDatabaseEmpty = async (config: DatabaseBackupConfig, databaseName: string): Promise<void> => {
  const connection = await mongoose.createConnection(config.backupDatabaseUrl, {
    dbName: databaseName,
    maxPoolSize: 1,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 15_000,
  }).asPromise()
  try {
    if (!connection.db) throw new Error(`Backup database handle is unavailable for ${databaseName}`)
    const existing = await connection.db.listCollections({}, { nameOnly: true }).toArray()
    if (existing.length > 0) throw new Error(`Refusing to restore into non-empty backup database ${databaseName}`)
  } finally {
    await connection.close()
  }
}

const persistPrimaryStatusSafely = async (work: () => Promise<void>, runId: string): Promise<void> => {
  try {
    await work()
  } catch (error) {
    logger.warn('database_backup_primary_status_write_failed', { runId, error: safeErrorMessage(error) })
  }
}

const dropPartialBackupDatabase = async (config: DatabaseBackupConfig, databaseName: string): Promise<void> => {
  if (!databaseName.startsWith(`${config.backupDatabasePrefix}_`)) return
  const connection = await mongoose.createConnection(config.backupDatabaseUrl, {
    dbName: databaseName,
    maxPoolSize: 1,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 15_000,
  }).asPromise()
  try {
    if (connection.db) await connection.db.dropDatabase()
  } finally {
    await connection.close()
  }
}

export const DatabaseBackupService = {
  async runOnce(): Promise<DatabaseBackupManifest> {
    const config = loadDatabaseBackupConfig()
    const releaseLock = await acquireLock(config)
    const started = new Date()
    const runId = crypto.randomUUID()
    const backupDatabase = buildBackupDatabaseName(config.backupDatabasePrefix, started, config.timezone)
    let toolConfigDir = ''
    let sourceConfigFile = ''
    let backupConfigFile = ''
    let restoreVerified = false
    let manifest: DatabaseBackupManifest = {
      schemaVersion: 2,
      runId,
      status: 'running',
      startedAt: started.toISOString(),
      timezone: config.timezone,
      schedule: config.cron,
      sourceDatabase: config.sourceDatabaseName,
      backupDatabase,
      transferMode: 'atlas_stream',
      archiveRetained: false,
      gcsProtection: { checked: false, protected: false, mode: config.gcsProtectionMode, message: 'Not checked yet.' },
    }

    try {
      await persistPrimaryStatusSafely(() => DatabaseBackupStatusStore.markStarted(config, { runId, backupDatabase, startedAt: manifest.startedAt }), runId)
      toolConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'real-estate-db-backup-'))
      await fs.chmod(toolConfigDir, 0o700)
      sourceConfigFile = await secureToolConfig(toolConfigDir, 'source', config.sourceDatabaseUrl)
      backupConfigFile = await secureToolConfig(toolConfigDir, 'backup', config.backupDatabaseUrl)
      manifest.mongoDumpVersion = await toolVersion('mongodump', config.processTimeoutMs)
      manifest.mongoRestoreVersion = await toolVersion('mongorestore', config.processTimeoutMs)
      manifest.gcsProtection = await inspectGcsProtection(config)
      if (!manifest.gcsProtection.protected && config.gcsProtectionMode === 'warn') {
        logger.warn('database_backup_gcs_media_not_protected', { bucket: config.gcpBucketName || 'unconfigured' })
      }

      logger.info('database_backup_started', { runId, sourceDatabase: config.sourceDatabaseName, backupDatabase })
      manifest.sourceCollectionsBefore = await inspectDatabase(
        config.sourceDatabaseUrl,
        config.sourceDatabaseName,
        config.maxParallelCollections,
      )

      // Every recovery point is restored into a unique, verified-empty database.
      await assertBackupDatabaseEmpty(config, backupDatabase)

      // Stream the compressed native MongoDB archive directly from the primary
      // Atlas cluster into the secondary Atlas cluster. No database dump is
      // retained on this host/container.
      const transfer = await streamDumpToRestore(
        sourceConfigFile,
        backupConfigFile,
        config.sourceDatabaseName,
        backupDatabase,
        config.maxParallelCollections,
        config.processTimeoutMs,
      )
      manifest.archiveBytes = transfer.archiveBytes
      manifest.archiveSha256 = transfer.archiveSha256

      manifest.sourceCollectionsAfter = await inspectDatabase(
        config.sourceDatabaseUrl,
        config.sourceDatabaseName,
        config.maxParallelCollections,
      )
      const restoredCollections = await inspectDatabase(
        config.backupDatabaseUrl,
        backupDatabase,
        config.maxParallelCollections,
      )
      manifest.restoreVerification = verifyRestore(
        manifest.sourceCollectionsBefore,
        manifest.sourceCollectionsAfter,
        restoredCollections,
      )
      if (!manifest.restoreVerification.passed) {
        throw new Error('Restore verification failed; inspect manifest collection/index/count details')
      }
      restoreVerified = true

      manifest.archiveRetained = false
      manifest.status = 'success'
      manifest.finishedAt = new Date().toISOString()
      await persistRemoteManifest(config, manifest)
      manifest.retention = await runRetention(config, backupDatabase)
      await persistRemoteManifest(config, manifest)
      await persistPrimaryStatusSafely(() => DatabaseBackupStatusStore.markSuccess(config, {
        runId,
        backupDatabase,
        startedAt: manifest.startedAt,
        finishedAt: manifest.finishedAt!,
        restoreVerified: Boolean(manifest.restoreVerification?.passed),
      }), runId)
      logger.info('database_backup_completed', {
        runId,
        backupDatabase,
        archiveBytes: manifest.archiveBytes,
        restoredDocuments: manifest.restoreVerification.restoredTotal,
      })
      return manifest
    } catch (error) {
      manifest = {
        ...manifest,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: {
          name: error instanceof Error ? error.name : 'Error',
          message: safeErrorMessage(error),
        },
      }
      if (!restoreVerified) {
        manifest.archiveRetained = false
        await dropPartialBackupDatabase(config, backupDatabase).catch((dropError) => {
          logger.warn('database_backup_partial_restore_cleanup_failed', { runId, backupDatabase, error: dropError })
        })
      }
      await persistPrimaryStatusSafely(() => DatabaseBackupStatusStore.markFailed(config, {
        runId,
        backupDatabase,
        startedAt: manifest.startedAt,
        finishedAt: manifest.finishedAt!,
        error: manifest.error?.message || 'Database backup failed',
      }), runId)
      await persistRemoteManifest(config, manifest).catch((persistError) => {
        logger.error('database_backup_failure_manifest_persist_failed', { runId, error: persistError })
      })
      logger.error('database_backup_failed', { runId, backupDatabase, error })
      throw error
    } finally {
      if (sourceConfigFile) await fs.unlink(sourceConfigFile).catch(() => undefined)
      if (backupConfigFile) await fs.unlink(backupConfigFile).catch(() => undefined)
      if (toolConfigDir) await fs.rm(toolConfigDir, { recursive: true, force: true }).catch(() => undefined)
      await releaseLock()
    }
  },
}

export default DatabaseBackupService
