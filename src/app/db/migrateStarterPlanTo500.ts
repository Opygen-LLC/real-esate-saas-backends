import mongoose, { ClientSession } from 'mongoose'
import config from '../../config'
import { mongoSupportsTransactions } from './mongoCapabilities'
import { SubscriptionPlan } from '../module/subscriptionPlan/subscriptionPlan.model'
import { Cache } from '../../shared/cache'
import { RedisClient } from '../../shared/redisClient'

const STARTER_MONTHLY = 500
const STARTER_YEARLY = 5000

const applyMigration = async (session?: ClientSession): Promise<'updated' | 'noop'> => {
  const currentQuery = SubscriptionPlan.findOne({ planId: 'starter', isCurrent: true }).sort({ version: -1 })
  if (session) currentQuery.session(session)
  const current = await currentQuery

  if (!current) {
    throw new Error('Starter plan was not found. Bootstrap the subscription catalog before applying the ৳500 migration.')
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
