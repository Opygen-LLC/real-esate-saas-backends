import mongoose from 'mongoose'
import config from '../../config'
import { ONBOARDING_TOTAL_STEPS, ONBOARDING_VERSION } from '../module/organization/onboarding.constants'
import { backupDocuments, migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'onboarding-four-steps'

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const collection = db.collection('organizations')
  const filter = { 'onboarding.currentStep': { $gt: ONBOARDING_TOTAL_STEPS } }
  const affected = await collection.countDocuments(filter)

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} affected=${affected}`)
  if (!cli.apply) {
    console.log(`[${MIGRATION}] No documents changed. Use --apply after reviewing this plan.`)
    return
  }

  const backup = affected > 0
    ? await backupDocuments({
      collection,
      filter,
      migrationName: MIGRATION,
      backupDir: cli.backupDir,
      projection: { organizationId: 1, onboarding: 1, updatedAt: 1 },
    })
    : null

  const result = affected > 0
    ? await collection.updateMany(filter, {
      $set: {
        'onboarding.currentStep': ONBOARDING_TOTAL_STEPS,
        'onboarding.version': ONBOARDING_VERSION,
      },
    })
    : { matchedCount: 0, modifiedCount: 0 }

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    affected,
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    backup,
  })
  console.log(`[${MIGRATION}] completed modified=${result.modifiedCount} manifest=${manifest}`)
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined)
  })
