import mongoose from 'mongoose'
import config from '../../config'
import { backupDocuments, migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'phase0-moderation-removal'

const run = async () => {
  const cli = migrationCli()
  requireConfirmation(cli, 'REMOVE_MODERATION_FIELDS')
  await mongoose.connect(config.database_string, { autoIndex: false, serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')
  const properties = db.collection('properties')
  const filter = { $or: [
    { moderationStatus: { $exists: true } },
    { moderationReason: { $exists: true } },
    { moderatedBy: { $exists: true } },
    { moderatedAt: { $exists: true } },
  ] }
  const affected = await properties.countDocuments(filter)
  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} propertiesWithModerationFields=${affected}`)

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data changed. This migration is intentionally Phase-3-gated.`)
    return
  }
  if (!cli.phase3Ready) throw new Error('Refusing to remove moderation fields before Phase 3 code is deployed. Add --phase3-ready after the moderation runtime dependency is removed.')

  const backup = await backupDocuments({
    collection: properties,
    filter,
    migrationName: MIGRATION,
    backupDir: cli.backupDir,
    projection: { organizationId: 1, title: 1, status: 1, moderationStatus: 1, moderationReason: 1, moderatedBy: 1, moderatedAt: 1 },
  })

  const result = await properties.updateMany(filter, { $unset: { moderationStatus: '', moderationReason: '', moderatedBy: '', moderatedAt: '' } })
  const existingIndexes = await properties.indexes()
  const moderationIndexes = existingIndexes.filter(index => Object.keys(index.key || {}).includes('moderationStatus'))
  for (const index of moderationIndexes) if (index.name) await properties.dropIndex(index.name)

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    backup,
    matched: result.matchedCount,
    modified: result.modifiedCount,
    droppedIndexes: moderationIndexes.map(index => index.name),
  })
  console.log(`[${MIGRATION}] completed backup=${backup.file} manifest=${manifest}`)
}

run().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => { await mongoose.disconnect().catch(() => undefined) })
