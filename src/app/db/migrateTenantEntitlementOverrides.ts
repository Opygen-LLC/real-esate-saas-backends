import mongoose from 'mongoose'
import config from '../../config'

const apply = process.argv.includes('--apply')

const run = async () => {
  await mongoose.connect(config.database_url as string)
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection unavailable')
  const overrides = db.collection('tenantentitlementoverrides')
  const organizations = db.collection('organizations')
  const existing = await overrides.countDocuments({})
  const tenantAssignments = await organizations.countDocuments({ 'subscription.plan': { $exists: true } })
  console.log(JSON.stringify({
    apply,
    existingTenantEntitlementOverrides: existing,
    organizationsWithSubscriptionAssignments: tenantAssignments,
    organizationPlanMutation: false,
    organizationPlanVersionMutation: false,
    historicalPlanLimitMutation: false,
  }, null, 2))
  if (!apply) return

  await overrides.createIndex({ organizationId: 1, version: 1 }, { unique: true, name: 'tenant_entitlement_override_version_unique' })
  await overrides.createIndex({ activeKey: 1 }, { unique: true, sparse: true, name: 'tenant_entitlement_override_one_active' })
  await overrides.createIndex({ organizationId: 1, status: 1, startsAt: -1, _id: -1 }, { name: 'tenant_entitlement_override_history' })
  await overrides.createIndex({ status: 1, expiresAt: 1 }, { name: 'tenant_entitlement_override_expiry_worker' })
  console.log('Tenant entitlement override indexes created. Existing organization plan/version assignments and historical plan limits were not modified.')
}

run().catch((error) => { console.error(error); process.exitCode = 1 }).finally(async () => { await mongoose.disconnect() })
