import mongoose from 'mongoose'
import config from '../../config'

const apply = process.argv.includes('--apply')

const run = async () => {
  await mongoose.connect(config.database_url as string)
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection unavailable')
  const plans = db.collection('subscriptionplans')
  const subscriptions = db.collection('leadaddonsubscriptions')
  const definitions = db.collection('leadaddondefinitions')

  const missing = await plans.countDocuments({ maxRecurringLeadAddon: { $exists: false } })
  console.log(JSON.stringify({ apply, planVersionsMissingMaxRecurringLeadAddon: missing, defaultBackfill: 0, tenantPlanAssignmentsModified: false }, null, 2))
  if (!apply) return

  await plans.updateMany({ maxRecurringLeadAddon: { $exists: false } }, { $set: { maxRecurringLeadAddon: 0 } })
  await definitions.createIndex({ slug: 1 }, { unique: true })
  await definitions.createIndex({ isActive: 1, archivedAt: 1, displayOrder: 1 })
  await subscriptions.createIndex({ organizationId: 1, status: 1, currentPeriodEnd: 1 })
  await subscriptions.createIndex({ organizationId: 1, definitionId: 1, createdAt: -1 })
  await subscriptions.createIndex({ organizationId: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'pending_payment' } })
  console.log('Recurring lead add-on structural migration applied. Existing tenant plan/version assignments and legacy top-up grants were not modified.')
}

run().catch((error) => { console.error(error); process.exitCode = 1 }).finally(async () => { await mongoose.disconnect() })
