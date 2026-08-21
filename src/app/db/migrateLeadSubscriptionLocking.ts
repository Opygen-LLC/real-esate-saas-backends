import mongoose from 'mongoose'
import config from '../../config'
import { backupDocuments, migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'lead-subscription-locking-v1'
const INDEX_NAME = 'lead_tenant_lock_created'

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const leads = db.collection('leads')
  const missingLockFilter = { isLocked: { $exists: false } }
  const missingLockState = await leads.countDocuments(missingLockFilter)
  const existingIndexes = await leads.indexes().catch(() => [])
  const existingIndex = existingIndexes.find((index) => index.name === INDEX_NAME)
  const expectedKey = { organizationId: 1, isLocked: 1, createdAt: -1, _id: -1 } as const

  if (existingIndex && JSON.stringify(existingIndex.key) !== JSON.stringify(expectedKey)) {
    throw new Error(`[${MIGRATION}] Refusing to replace conflicting index ${INDEX_NAME}: ${JSON.stringify(existingIndex.key)}`)
  }

  console.log(JSON.stringify({
    migration: MIGRATION,
    mode: cli.apply ? 'APPLY' : 'DRY-RUN',
    leadsMissingIsLocked: missingLockState,
    indexPresent: Boolean(existingIndex),
    index: { name: INDEX_NAME, key: expectedKey },
    destructiveDataMutation: false,
    planMutation: false,
  }, null, 2))

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data or indexes changed. Re-run with --apply after reviewing the dry-run output.`)
    return
  }

  const backup = await backupDocuments({
    collection: leads,
    filter: missingLockFilter,
    projection: { _id: 1, organizationId: 1, createdAt: 1 },
    migrationName: MIGRATION,
    backupDir: cli.backupDir,
  })

  const backfill = await leads.updateMany(
    missingLockFilter,
    { $set: { isLocked: false } },
  )

  await leads.createIndex(expectedKey, { name: INDEX_NAME })

  const remainingMissing = await leads.countDocuments(missingLockFilter)
  if (remainingMissing !== 0) throw new Error(`[${MIGRATION}] Postcondition failed: ${remainingMissing} Lead records still have no isLocked value`)

  const installed = (await leads.indexes()).find((index) => index.name === INDEX_NAME)
  if (!installed || JSON.stringify(installed.key) !== JSON.stringify(expectedKey)) {
    throw new Error(`[${MIGRATION}] Postcondition failed: ${INDEX_NAME} was not installed with the expected key`)
  }

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    backup,
    leadsBackfilled: Number(backfill.modifiedCount || 0),
    index: { name: INDEX_NAME, key: expectedKey },
    destructiveDataMutation: false,
    planMutation: false,
    note: 'Existing Leads are initialized as accessible. Active-capacity reconciliation applies locks at plan transitions and request-time entitlement boundaries; grandfathered credit plans remain accessible.',
  })
  console.log(`[${MIGRATION}] completed manifest=${manifest}`)
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
