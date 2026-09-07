import mongoose from 'mongoose'
import config from '../../config'
import { backupDocuments, migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'
import { LEGACY_WEBSITE_RENDERER_VERSION } from '../../contracts/websiteCatalog/manifest'

const MIGRATION = 'phase5-website-renderer-binding'
const CONFIRM = 'APPLY_PHASE5_WEBSITE_RENDERER_BINDING'

const run = async () => {
  const cli = migrationCli()
  requireConfirmation(cli, CONFIRM)
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const targets = [
    { collection: 'organizations', filter: { 'websiteSettings.rendererVersion': { $exists: false } }, update: { $set: { 'websiteSettings.rendererVersion': LEGACY_WEBSITE_RENDERER_VERSION } } },
    { collection: 'websitestudios', filter: { 'snapshot.websiteSettings.rendererVersion': { $exists: false } }, update: { $set: { 'snapshot.websiteSettings.rendererVersion': LEGACY_WEBSITE_RENDERER_VERSION } } },
    { collection: 'websitestudiorevisions', filter: { 'snapshot.websiteSettings.rendererVersion': { $exists: false } }, update: { $set: { 'snapshot.websiteSettings.rendererVersion': LEGACY_WEBSITE_RENDERER_VERSION } } },
  ] as const

  const counts: Record<string, number> = {}
  for (const target of targets) counts[target.collection] = await db.collection(target.collection).countDocuments(target.filter)
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'}`)
  console.log(JSON.stringify({ rendererVersion: LEGACY_WEBSITE_RENDERER_VERSION, counts, total, existingTenantDesignChanges: 0 }, null, 2))

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No changes made. Apply only after verifying backups: --apply --confirm=${CONFIRM}`)
    return
  }

  const backups = []
  for (const target of targets) {
    if (!counts[target.collection]) continue
    backups.push(await backupDocuments({ collection: db.collection(target.collection), filter: target.filter, migrationName: MIGRATION, backupDir: cli.backupDir }))
  }

  const applied: Record<string, number> = {}
  for (const target of targets) {
    const result = await db.collection(target.collection).updateMany(target.filter, target.update)
    applied[target.collection] = result.modifiedCount
  }
  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    rendererVersion: LEGACY_WEBSITE_RENDERER_VERSION,
    before: counts,
    applied,
    backups,
    rollback: 'Restore the backed-up JSONL documents before changing WEBSITE_RENDERER_ROLLOUT_MODE. Historical revisions remain version-bound.',
  })
  console.log(`[${MIGRATION}] manifest=${manifest}`)
}

run().catch((error) => { console.error(error); process.exitCode = 1 }).finally(async () => { await mongoose.disconnect().catch(() => undefined) })
