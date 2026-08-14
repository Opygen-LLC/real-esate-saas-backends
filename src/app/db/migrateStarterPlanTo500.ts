import mongoose, { ClientSession } from 'mongoose'
import config from '../../config'
import { mongoSupportsTransactions } from './mongoCapabilities'
import { SubscriptionPlan } from '../module/subscriptionPlan/subscriptionPlan.model'
import { SubscriptionPlanService } from '../module/subscriptionPlan/subscriptionPlan.service'
import { Cache } from '../../shared/cache'
import { RedisClient } from '../../shared/redisClient'

const STARTER_MONTHLY = 500
const STARTER_YEARLY = 5000

const applyMigration = async (session?: ClientSession): Promise<'updated' | 'noop'> => {
  const currentQuery = SubscriptionPlan.findOne({ planId: 'starter', isCurrent: true }).sort({ version: -1 })
  if (session) currentQuery.session(session)
  let current = await currentQuery

  if (!current) {
    await SubscriptionPlanService.getAllPlans()
    const retryQuery = SubscriptionPlan.findOne({ planId: 'starter', isCurrent: true }).sort({ version: -1 })
    if (session) retryQuery.session(session)
    current = await retryQuery
  }

  if (!current) {
    const now = new Date()
    const [created] = await SubscriptionPlan.create([{
      planId: 'starter',
      version: 1,
      name: 'Starter',
      priceMonthly: STARTER_MONTHLY,
      priceYearly: STARTER_YEARLY,
      currency: 'BDT',
      description: 'A practical starting point for independent agents and small property businesses in Bangladesh.',
      features: ['1–3 Team Agents', '100 Property Listings', '500 Active Leads', 'Public Agency Website', 'Basic CRM & Activity Feed', 'Agency Subdomain', 'Standard Support'],
      maxAgents: 3,
      maxProperties: 100,
      maxLeads: 500,
      hasCustomDomain: false,
      hasAdvancedAnalytics: false,
      hasWhatsAppIntegration: false,
      hasLeadAutomations: false,
      hasSmsAutomation: false,
      hasPremiumTemplates: false,
      maxStorageMb: 1024,
      maxMonthlyVisitors: 10000,
      isPopular: false,
      isCurrent: true,
      isActive: true,
      effectiveFrom: now,
      effectiveTo: null,
      grandfatherExisting: true,
      migrationAppliedAt: now,
      createdBy: 'starter-500-migration',
      changeReason: 'Initial bootstrap of Starter plan at BDT 500/month.',
    }], session ? { session } : undefined)
    current = created
  }


  if (current.currency === 'BDT' && current.priceMonthly === STARTER_MONTHLY && current.priceYearly === STARTER_YEARLY) {
    return 'noop'
  }

  const latestQuery = SubscriptionPlan.findOne({ planId: 'starter' }).sort({ version: -1 }).lean()
  if (session) latestQuery.session(session)
  const latest = await latestQuery
  const now = new Date()
  const snapshot = current.toObject()
  const nextVersion = Number(latest?.version || current.version || 1) + 1

  current.isCurrent = false
  current.effectiveTo = now
  await current.save(session ? { session } : undefined)

  await SubscriptionPlan.create([{
    ...snapshot,
    _id: undefined,
    __v: undefined,
    createdAt: undefined,
    updatedAt: undefined,
    planId: 'starter',
    version: nextVersion,
    name: 'Starter',
    priceMonthly: STARTER_MONTHLY,
    priceYearly: STARTER_YEARLY,
    currency: 'BDT',
    description: 'A practical starting point for independent agents and small property businesses in Bangladesh.',
    isCurrent: true,
    isActive: true,
    effectiveFrom: now,
    effectiveTo: null,
    grandfatherExisting: true,
    migrationAppliedAt: now,
    createdBy: 'starter-500-migration',
    changeReason: 'Launch Bangladesh Starter pricing at BDT 500/month while grandfathering existing subscriptions.',
  }], session ? { session } : undefined)

  return 'updated'
}

const run = async (): Promise<void> => {
  await mongoose.connect(config.database_string, { autoIndex: false })
  const collection = mongoose.connection.collection('subscriptionplans')
  try {
    const indexes = await collection.indexes()
    const legacyIndex = indexes.find((idx: any) => idx.name === 'planId_1' && idx.unique && Object.keys(idx.key || {}).length === 1 && idx.key.planId)
    if (legacyIndex) {
      await collection.dropIndex('planId_1')
    }
  } catch (_e) {
    // collection might not exist yet
  }

  const supportsTransactions = await mongoSupportsTransactions()

  let result: 'updated' | 'noop'
  if (supportsTransactions) {
    const session = await mongoose.startSession()
    try {
      let migrationResult: 'updated' | 'noop' = 'noop'
      await session.withTransaction(async () => {
        migrationResult = await applyMigration(session)
      })
      result = migrationResult
    } finally {
      await session.endSession()
    }
  } else {
    if (config.isProduction) {
      throw new Error('Production starter-price migration requires a MongoDB replica set or mongos.')
    }
    result = await applyMigration()
  }

  await Cache.plans.del('catalog')
  console.log(result === 'updated' ? 'Starter plan vNext created at BDT 500/month.' : 'Starter plan is already BDT 500/month; no changes required.')

  RedisClient.close()
  await mongoose.disconnect()
}

run().catch(async (error: unknown) => {
  console.error('Starter plan migration failed:', error instanceof Error ? error.message : error)
  RedisClient.close()
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
