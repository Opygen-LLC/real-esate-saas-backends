import crypto from 'node:crypto'
import mongoose from 'mongoose'
import config from '../../config'

const apply = process.argv.includes('--apply')

const digestTenantAssignments = async (organizations: any) => {
  const hash = crypto.createHash('sha256')
  const cursor = organizations.find({}, { projection: { _id: 0, organizationId: 1, 'subscription.plan': 1, 'subscription.planVersion': 1 } }).sort({ organizationId: 1 })
  for await (const row of cursor) {
    hash.update(JSON.stringify({
      organizationId: String(row.organizationId || ''),
      plan: String(row.subscription?.plan || ''),
      planVersion: Number(row.subscription?.planVersion || 0),
    }))
    hash.update('\n')
  }
  return hash.digest('hex')
}

const run = async () => {
  await mongoose.connect(config.database_url as string)
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection unavailable')

  const organizations = db.collection('organizations')
  const plans = db.collection('subscriptionplans')
  const legacyTopups = db.collection('leadtopupgrants')
  const addonDefinitions = db.collection('leadaddondefinitions')
  const addonSubscriptions = db.collection('leadaddonsubscriptions')
  const tenantOverrides = db.collection('tenantentitlementoverrides')

  const assignmentDigestBefore = await digestTenantAssignments(organizations)
  const [
    planVersionsMissingAddonCeiling,
    organizationsMissingLifecycle,
    legacyTopupGrantCount,
    recurringAddonCount,
    entitlementOverrideCount,
  ] = await Promise.all([
    plans.countDocuments({ maxRecurringLeadAddon: { $exists: false } }),
    organizations.countDocuments({ 'platformAccess.status': { $exists: false } }),
    legacyTopups.countDocuments({}),
    addonSubscriptions.countDocuments({}),
    tenantOverrides.countDocuments({}),
  ])

  console.log(JSON.stringify({
    apply,
    planVersionsMissingAddonCeiling,
    historicalAddonCeilingDefault: 0,
    organizationsMissingLifecycle,
    lifecycleBackfillRule: 'isBlocked=true -> suspended; otherwise active',
    legacyTopupGrantCount,
    legacyTopupConversion: false,
    recurringAddonCount,
    entitlementOverrideCount,
    organizationPlanMutation: false,
    organizationPlanVersionMutation: false,
    historicalPlanPriceMutation: false,
    historicalLeadLimitMutation: false,
    assignmentDigestBefore,
  }, null, 2))

  if (!apply) return

  // Structural-only plan backfill. Unknown historical add-on entitlement must remain unavailable.
  await plans.updateMany(
    { maxRecurringLeadAddon: { $exists: false } },
    { $set: { maxRecurringLeadAddon: 0 } },
  )

  // Structural lifecycle backfill only; never infer or rewrite subscription plan/version.
  await organizations.updateMany(
    { 'platformAccess.status': { $exists: false }, isBlocked: true },
    { $set: { 'platformAccess.status': 'suspended' } },
  )
  await organizations.updateMany(
    { 'platformAccess.status': { $exists: false }, isBlocked: { $ne: true } },
    { $set: { 'platformAccess.status': 'active' } },
  )

  // Idempotent structural indexes for the Phase 5/6 collections.
  await addonDefinitions.createIndex({ slug: 1 }, { unique: true })
  await addonDefinitions.createIndex({ isActive: 1, archivedAt: 1, displayOrder: 1 })
  await addonSubscriptions.createIndex({ organizationId: 1, status: 1, currentPeriodEnd: 1 })
  await addonSubscriptions.createIndex({ organizationId: 1, definitionId: 1, createdAt: -1 })
  await addonSubscriptions.createIndex(
    { organizationId: 1, status: 1 },
    { unique: true, partialFilterExpression: { status: 'pending_payment' } },
  )
  await tenantOverrides.createIndex(
    { organizationId: 1, version: 1 },
    { unique: true, name: 'tenant_entitlement_override_version_unique' },
  )
  await tenantOverrides.createIndex(
    { activeKey: 1 },
    { unique: true, sparse: true, name: 'tenant_entitlement_override_one_active' },
  )
  await tenantOverrides.createIndex(
    { organizationId: 1, status: 1, startsAt: -1, _id: -1 },
    { name: 'tenant_entitlement_override_history' },
  )
  await tenantOverrides.createIndex(
    { status: 1, expiresAt: 1 },
    { name: 'tenant_entitlement_override_expiry_worker' },
  )
  await organizations.createIndex({ 'platformAccess.status': 1 })

  const assignmentDigestAfter = await digestTenantAssignments(organizations)
  if (assignmentDigestAfter !== assignmentDigestBefore) {
    throw new Error('SAFETY ABORT: tenant subscription plan/version assignments changed during Phase 7 migration')
  }

  const legacyTopupGrantCountAfter = await legacyTopups.countDocuments({})
  if (legacyTopupGrantCountAfter !== legacyTopupGrantCount) {
    throw new Error('SAFETY ABORT: legacy LeadTopupGrant records changed during Phase 7 migration')
  }

  console.log(JSON.stringify({
    applied: true,
    assignmentDigestAfter,
    assignmentDigestUnchanged: true,
    legacyTopupGrantCountAfter,
    legacyTopupGrantCountUnchanged: true,
    organizationPlanMutation: false,
    organizationPlanVersionMutation: false,
    legacyTopupConversion: false,
  }, null, 2))
  console.log('Phase 7 subscription-platform structural migration applied safely.')
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect() })
