import mongoose from 'mongoose'
import config from '../../config'
import { backupDocuments, migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'property-public-visibility'
const CONFIRMATION = 'PROPERTY-PUBLIC-VISIBILITY'

const run = async () => {
  const cli = migrationCli()
  requireConfirmation(cli, CONFIRMATION)
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const properties = db.collection('properties')
  const filter = { hiddenPublicFields: { $exists: false } }
  const affected = await properties.countDocuments(filter)
  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} missingVisibilityField=${affected}`)

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data changed. Re-run with --apply --confirm=${CONFIRMATION} after reviewing the count.`)
    return
  }

  const backup = affected
    ? await backupDocuments({ collection: properties, filter, migrationName: MIGRATION, backupDir: cli.backupDir })
    : null
  if (backup && backup.count !== affected) throw new Error(`Backup validation failed: expected ${affected}, backed up ${backup.count}`)

  if (affected) await properties.updateMany(filter, { $set: { hiddenPublicFields: [] } })
  const remaining = await properties.countDocuments(filter)
  const invalid = await properties.countDocuments({ hiddenPublicFields: { $not: { $type: 'array' } } } as never)
  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    affected,
    changed: affected,
    backup,
    verification: { missingVisibilityField: remaining, nonArrayVisibilityField: invalid },
  })

  if (remaining || invalid) throw new Error(`Post-migration verification failed. manifest=${manifest}`)
  console.log(`[${MIGRATION}] completed changed=${affected} manifest=${manifest}`)
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
