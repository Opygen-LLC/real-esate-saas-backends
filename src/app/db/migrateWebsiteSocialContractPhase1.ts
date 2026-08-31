import mongoose from 'mongoose'
import config from '../../config'
import { backupDocuments, migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'website-social-contract-phase1-v1'
const CONFIRMATION = 'website-social-contract-phase1'

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

  const twitterFilter = {
    'socialLinks.twitter': { $type: 'string', $ne: '' },
    $or: [{ 'socialLinks.x': { $exists: false } }, { 'socialLinks.x': '' }],
  }
  const footerFilter = { 'websiteSettings.footer.showSocialLinks': { $exists: false } }
  const visibilityFields = ['facebook', 'instagram', 'youtube', 'x'] as const
  const visibilityFilters = Object.fromEntries(
    visibilityFields.map((field) => [field, { [`websiteSettings.footer.socialVisibility.${field}`]: { $exists: false } }]),
  ) as Record<(typeof visibilityFields)[number], Record<string, unknown>>

  const [legacyTwitter, missingFooter, ...visibilityCounts] = await Promise.all([
    organizations.countDocuments(twitterFilter),
    organizations.countDocuments(footerFilter),
    ...visibilityFields.map((field) => organizations.countDocuments(visibilityFilters[field])),
  ])
  const missingVisibility = Object.fromEntries(visibilityFields.map((field, index) => [field, visibilityCounts[index]]))
  const totalVisibilityMissing = visibilityCounts.reduce((sum: number, count: number) => sum + count, 0)

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} twitterBackfill=${legacyTwitter} footerDefaults=${missingFooter} visibilityFieldDefaults=${totalVisibilityMissing}`)
  console.log(JSON.stringify({ missingVisibility }))

  const summary = { legacyTwitter, missingFooter, missingVisibility }
  if (!cli.apply) {
    const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, { mode: 'dry-run', ...summary })
    console.log(`[${MIGRATION}] manifest=${manifest}; no data changed. Re-run with --apply --confirm=${CONFIRMATION} after review.`)
    return
  }

  const affectedFilter = {
    $or: [
      twitterFilter,
      footerFilter,
      ...visibilityFields.map((field) => visibilityFilters[field]),
    ],
  }
  const backup = await backupDocuments({ collection: organizations, filter: affectedFilter, migrationName: MIGRATION, backupDir: cli.backupDir })

  // MongoDB pipeline update copies the legacy value server-side and avoids loading
  // every organization into application memory. The legacy field remains readable
  // during the compatibility window and new application writes remove it.
  const twitterResult = await organizations.updateMany(twitterFilter, [
    { $set: { 'socialLinks.x': '$socialLinks.twitter' } },
  ])
  const footerResult = await organizations.updateMany(footerFilter, { $set: { 'websiteSettings.footer.showSocialLinks': true } })
  const visibilityApplied: Record<string, number> = {}
  for (const field of visibilityFields) {
    const result = await organizations.updateMany(visibilityFilters[field], { $set: { [`websiteSettings.footer.socialVisibility.${field}`]: true } })
    visibilityApplied[field] = result.modifiedCount
  }

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    mode: 'apply',
    ...summary,
    backup,
    twitterUpdated: twitterResult.modifiedCount,
    footerDefaultsApplied: footerResult.modifiedCount,
    visibilityDefaultsApplied: visibilityApplied,
  })
  console.log(`[${MIGRATION}] completed manifest=${manifest}`)
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
