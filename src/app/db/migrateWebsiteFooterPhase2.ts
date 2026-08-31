import mongoose from 'mongoose'
import config from '../../config'
import { backupDocuments, migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'website-footer-phase2-v1'
const CONFIRMATION = 'website-footer-phase2'
const SOCIAL_VISIBILITY_FIELDS = ['facebook', 'instagram', 'youtube', 'x'] as const

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
  const organizations = db.collection('organizations')

  // Copy legacy Twitter only when the canonical X field is genuinely absent.
  // Existing explicit X values, including an intentionally empty string, win.
  const legacyTwitterFilter = {
    'socialLinks.twitter': { $type: 'string', $ne: '' },
    'socialLinks.x': { $exists: false },
  }
  const masterVisibilityFilter = { 'websiteSettings.footer.showSocialLinks': { $exists: false } }
  const perNetworkFilters = Object.fromEntries(
    SOCIAL_VISIBILITY_FIELDS.map((field) => [
      field,
      { [`websiteSettings.footer.socialVisibility.${field}`]: { $exists: false } },
    ]),
  ) as Record<(typeof SOCIAL_VISIBILITY_FIELDS)[number], Record<string, unknown>>

  const [legacyTwitterCount, masterVisibilityCount, ...networkCounts] = await Promise.all([
    organizations.countDocuments(legacyTwitterFilter),
    organizations.countDocuments(masterVisibilityFilter),
    ...SOCIAL_VISIBILITY_FIELDS.map((field) => organizations.countDocuments(perNetworkFilters[field])),
  ])
  const missingPerNetwork = Object.fromEntries(
    SOCIAL_VISIBILITY_FIELDS.map((field, index) => [field, networkCounts[index]]),
  )
  const summary = { legacyTwitterCount, masterVisibilityCount, missingPerNetwork }

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'}`)
  console.log(JSON.stringify(summary, null, 2))

  if (!cli.apply) {
    const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, { mode: 'dry-run', ...summary })
    console.log(`[${MIGRATION}] manifest=${manifest}; no data changed.`)
    console.log(`[${MIGRATION}] apply after review with --apply --confirm=${CONFIRMATION}`)
    return
  }

  const affectedFilter = {
    $or: [legacyTwitterFilter, masterVisibilityFilter, ...SOCIAL_VISIBILITY_FIELDS.map((field) => perNetworkFilters[field])],
  }
  const backup = await backupDocuments({
    collection: organizations,
    filter: affectedFilter,
    migrationName: MIGRATION,
    backupDir: cli.backupDir,
  })

  const twitterResult = await organizations.updateMany(legacyTwitterFilter, [
    { $set: { 'socialLinks.x': '$socialLinks.twitter' } },
  ])
  const masterResult = await organizations.updateMany(masterVisibilityFilter, {
    $set: { 'websiteSettings.footer.showSocialLinks': true },
  })
  const networkResults: Record<string, number> = {}
  for (const field of SOCIAL_VISIBILITY_FIELDS) {
    const result = await organizations.updateMany(perNetworkFilters[field], {
      $set: { [`websiteSettings.footer.socialVisibility.${field}`]: true },
    })
    networkResults[field] = result.modifiedCount
  }

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    mode: 'apply',
    ...summary,
    backup,
    twitterCopiedToX: twitterResult.modifiedCount,
    masterVisibilityDefaultsApplied: masterResult.modifiedCount,
    networkVisibilityDefaultsApplied: networkResults,
    legacyTwitterDeleted: 0,
  })
  console.log(`[${MIGRATION}] completed manifest=${manifest}`)
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined)
  })
