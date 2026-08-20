import mongoose from 'mongoose'
import config from '../../config'
import { migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'phase2-notification-lifecycle'

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const index = {
    collection: 'notifications',
    keys: { organizationId: 1, userId: 1, dismissedAt: 1, createdAt: -1, _id: -1 },
    options: { name: 'tenant_user_dismissed_created' },
  } as const

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} indexes=1`)
  if (!cli.apply) {
    console.log(`[${MIGRATION}] No indexes changed. Use --apply after reviewing this plan.`)
    return
  }

  await db.collection(index.collection).createIndex(index.keys, index.options)
  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    appliedIndexes: [`${index.collection}.${index.options.name}`],
  })
  console.log(`[${MIGRATION}] completed manifest=${manifest}`)
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
