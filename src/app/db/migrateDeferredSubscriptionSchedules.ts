import mongoose from 'mongoose'
import config from '../../config'
import { backupDocuments, migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'deferred-subscription-schedules-v1'
const CHANGE_TYPES = ['upgrade', 'downgrade', 'version_change'] as const
const PLAN_RANK: Record<string, number> = { trial: 0, starter: 1, professional: 2, agency: 3, enterprise: 4 }

const classifyChange = (currentPlan: unknown, requestedPlan: unknown): typeof CHANGE_TYPES[number] => {
  const current = String(currentPlan || 'trial')
  const requested = String(requestedPlan || 'starter')
  if (current === requested) return 'version_change'
  return (PLAN_RANK[requested] ?? Number.MAX_SAFE_INTEGER) < (PLAN_RANK[current] ?? -1) ? 'downgrade' : 'upgrade'
}

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const organizations = db.collection('organizations')
  const requests = db.collection('subscriptionchangerequests')
  const requestBackfillFilter = { changeType: { $nin: [...CHANGE_TYPES] } }
  const [organizationsMissingRevision, requestsMissingChangeType] = await Promise.all([
    organizations.countDocuments({ 'subscription.revision': { $exists: false } }),
    requests.countDocuments(requestBackfillFilter),
  ])

  console.log(JSON.stringify({
    migration: MIGRATION,
    mode: cli.apply ? 'APPLY' : 'DRY-RUN',
    organizationsMissingRevision,
    requestsMissingChangeType,
    planVersionMutation: false,
    indexes: [
      'organizations.subscription_due_schedule',
      'subscriptionchangerequests.changeType_1',
      'subscriptionchangerequests.scheduledEffectiveAt_1',
    ],
  }, null, 2))

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data or indexes changed. Re-run with --apply after reviewing the dry-run output.`)
    return
  }

  const [organizationBackup, requestBackup] = await Promise.all([
    backupDocuments({
      collection: organizations,
      filter: { 'subscription.revision': { $exists: false } },
      projection: { organizationId: 1, subscription: 1 },
      migrationName: MIGRATION,
      backupDir: cli.backupDir,
    }),
    backupDocuments({
      collection: requests,
      filter: requestBackfillFilter,
      migrationName: MIGRATION,
      backupDir: cli.backupDir,
    }),
  ])

  const organizationResult = await organizations.updateMany(
    { 'subscription.revision': { $exists: false } },
    { $set: { 'subscription.revision': 0 } },
  )

  let requestBackfilled = 0
  let operations: any[] = []
  const flush = async () => {
    if (!operations.length) return
    const result = await requests.bulkWrite(operations, { ordered: false })
    requestBackfilled += result.modifiedCount
    operations = []
  }
  const cursor = requests.find(requestBackfillFilter, { projection: { currentPlan: 1, requestedPlan: 1 } })
  for await (const request of cursor) {
    operations.push({
      updateOne: {
        filter: { _id: request._id, changeType: { $nin: [...CHANGE_TYPES] } },
        update: { $set: { changeType: classifyChange(request.currentPlan, request.requestedPlan) } },
      },
    })
    if (operations.length >= 500) await flush()
  }
  await flush()

  await Promise.all([
    organizations.createIndex(
      { 'subscription.scheduledEffectiveAt': 1, organizationId: 1 },
      {
        name: 'subscription_due_schedule',
        partialFilterExpression: { 'subscription.scheduledEffectiveAt': { $type: 'date' } },
      },
    ),
    requests.createIndex({ changeType: 1 }, { name: 'changeType_1' }),
    requests.createIndex({ scheduledEffectiveAt: 1 }, { name: 'scheduledEffectiveAt_1' }),
  ])

  // Hard postcondition: this migration must never alter the assigned plan/version.
  // The only Organization write above targets subscription.revision explicitly.
  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    organizationBackup,
    requestBackup,
    organizationsRevisionBackfilled: organizationResult.modifiedCount,
    requestsChangeTypeBackfilled: requestBackfilled,
    planVersionMutation: false,
    appliedIndexes: [
      'organizations.subscription_due_schedule',
      'subscriptionchangerequests.changeType_1',
      'subscriptionchangerequests.scheduledEffectiveAt_1',
    ],
  })
  console.log(`[${MIGRATION}] completed manifest=${manifest}`)
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
