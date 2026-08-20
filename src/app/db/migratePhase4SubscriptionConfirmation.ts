import mongoose from 'mongoose'
import config from '../../config'
import { migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'phase4-subscription-confirmation'

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const index = {
    collection: 'subscriptionpayments',
    keys: { organizationId: 1, status: 1, confirmationNoticeEligible: 1, confirmedAt: -1, _id: -1 },
    options: { name: 'tenant_confirmation_delivery' },
  } as const

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} indexes=1`)
  console.log(`[${MIGRATION}] Existing confirmed payments are intentionally left without confirmationNoticeEligible=true.`)
  console.log(`[${MIGRATION}] This prevents historical payments from replaying success modals after deployment.`)

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No indexes changed. Use --apply after reviewing this plan.`)
    return
  }

  await db.collection(index.collection).createIndex(index.keys, index.options)
  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    appliedIndexes: [`${index.collection}.${index.options.name}`],
    dataBackfill: 'none-existing-confirmed-payments-remain-ineligible',
  })
  console.log(`[${MIGRATION}] completed manifest=${manifest}`)
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
