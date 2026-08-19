import mongoose from 'mongoose'
import config from '../../config'
import { migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'team-quota'

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, { autoIndex: false, serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const indexes = [
    ['teaminvitations', { organizationId: 1, status: 1, expiresAt: 1 }, { name: 'tenant_status_expires' }],
    ['teaminvitations', { organizationId: 1, phoneNumber: 1, status: 1 }, { name: 'tenant_phone_status' }],
  ] as const

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} indexes=${indexes.length}`)
  if (!cli.apply) {
    console.log(`[${MIGRATION}] No indexes changed. Use --apply after reviewing this plan.`)
    return
  }

  const applied: string[] = []
  for (const [collectionName, keys, options] of indexes) {
    await db.collection(collectionName).createIndex(keys as any, options as any)
    applied.push(`${collectionName}.${options.name}`)
  }
  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, { appliedIndexes: applied })
  console.log(`[${MIGRATION}] completed manifest=${manifest}`)
}

run().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => { await mongoose.disconnect().catch(() => undefined) })
