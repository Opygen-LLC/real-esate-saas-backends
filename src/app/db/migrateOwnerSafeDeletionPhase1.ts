import mongoose from 'mongoose'
import config from '../../config'
import { migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'agency-owner-safe-deletion-phase1-v1'

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const websiteSubmissions = db.collection('websitesubmissions')
  const financeTransactions = db.collection('financetransactions')
  const financeCommissions = db.collection('financecommissions')

  const [submissionBackfillCount, transactionBackfillCount, commissionBackfillCount] = await Promise.all([
    websiteSubmissions.countDocuments({ deletedAt: { $exists: false } }),
    financeTransactions.countDocuments({ deletedAt: { $exists: false } }),
    financeCommissions.countDocuments({ archivedAt: { $exists: false } }),
  ])

  console.log(
    `[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} ` +
    `submissions=${submissionBackfillCount} transactions=${transactionBackfillCount} commissions=${commissionBackfillCount}`,
  )

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data or indexes changed. Use --apply after reviewing this plan.`)
    return
  }

  const [submissionBackfill, transactionBackfill, commissionBackfill] = await Promise.all([
    websiteSubmissions.updateMany(
      { deletedAt: { $exists: false } },
      { $set: { deletedAt: null, deletedBy: null, deleteReason: '' } },
    ),
    financeTransactions.updateMany(
      { deletedAt: { $exists: false } },
      { $set: { deletedAt: null, deletedBy: null, deleteReason: '' } },
    ),
    financeCommissions.updateMany(
      { archivedAt: { $exists: false } },
      { $set: { archivedAt: null, archivedBy: null, archiveReason: '' } },
    ),
  ])

  const appliedIndexes = await Promise.all([
    websiteSubmissions.createIndex({ organizationId: 1, deletedAt: 1, submittedAt: -1 }),
    financeTransactions.createIndex({ organizationId: 1, deletedAt: 1, createdAt: -1 }),
    financeCommissions.createIndex({ organizationId: 1, archivedAt: 1, createdAt: -1 }),
  ])

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    websiteSubmissionsBackfilled: submissionBackfill.modifiedCount,
    financeTransactionsBackfilled: transactionBackfill.modifiedCount,
    financeCommissionsBackfilled: commissionBackfill.modifiedCount,
    appliedIndexes,
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
