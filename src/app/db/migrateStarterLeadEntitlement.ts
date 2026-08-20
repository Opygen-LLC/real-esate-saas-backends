import mongoose, { ClientSession } from 'mongoose'
import config from '../../config'
import { Cache } from '../../shared/cache'
import { RedisClient } from '../../shared/redisClient'
import { SubscriptionPlan } from '../module/subscriptionPlan/subscriptionPlan.model'
import { SubscriptionPlanService } from '../module/subscriptionPlan/subscriptionPlan.service'
import { mongoSupportsTransactions } from './mongoCapabilities'
import { backupDocuments, migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'starter-lead-entitlement-v1'
const STARTER_CONFIG = {
  baseMonthlyLeadAllowance: 200,
  renewalLeadBonus: 50,
  renewalBonusEnabled: true,
  maxRenewalLeadBonus: 500,
  continuityGraceDays: 3,
} as const

const missingConfigFilter = {
  $or: [
    { baseMonthlyLeadAllowance: { $exists: false } },
    { renewalLeadBonus: { $exists: false } },
    { renewalBonusEnabled: { $exists: false } },
    { maxRenewalLeadBonus: { $exists: false } },
    { continuityGraceDays: { $exists: false } },
  ],
}

const hasStarterConfig = (plan: any): boolean =>
  Number(plan?.baseMonthlyLeadAllowance) === STARTER_CONFIG.baseMonthlyLeadAllowance
  && Number(plan?.renewalLeadBonus) === STARTER_CONFIG.renewalLeadBonus
  && plan?.renewalBonusEnabled === STARTER_CONFIG.renewalBonusEnabled
  && Number(plan?.maxRenewalLeadBonus) === STARTER_CONFIG.maxRenewalLeadBonus
  && Number(plan?.continuityGraceDays) === STARTER_CONFIG.continuityGraceDays

const starterFeatures = (features: unknown): string[] => {
  const source = Array.isArray(features) ? features.map(String) : []
  const filtered = source.filter((feature) => {
    const value = feature.toLowerCase()
    return !value.includes('active leads')
      && !value.includes('leads / paid month')
      && !value.includes('consecutive renewal')
      && !value.includes('active pipeline leads')
  })
  return [
    ...filtered,
    '200 Leads / Paid Month',
    '+50 Leads per Consecutive Renewal',
    'Up to 500 Active Pipeline Leads',
  ]
}

const neutralBackfill = async (session?: ClientSession) => {
  const collection = mongoose.connection.collection('subscriptionplans')
  return collection.updateMany(
    missingConfigFilter,
    [
      {
        $set: {
          baseMonthlyLeadAllowance: { $ifNull: ['$baseMonthlyLeadAllowance', { $ifNull: ['$maxLeads', 0] }] },
          renewalLeadBonus: { $ifNull: ['$renewalLeadBonus', 0] },
          renewalBonusEnabled: { $ifNull: ['$renewalBonusEnabled', false] },
          maxRenewalLeadBonus: { $ifNull: ['$maxRenewalLeadBonus', 0] },
          continuityGraceDays: { $ifNull: ['$continuityGraceDays', 0] },
        },
      },
    ],
    session ? { session } : undefined,
  )
}

const createStarterVersionIfNeeded = async (session?: ClientSession): Promise<{ created: boolean; version?: number }> => {
  const currentQuery = SubscriptionPlan.findOne({ planId: 'starter', isCurrent: true }).sort({ version: -1 })
  if (session) currentQuery.session(session)
  const current = await currentQuery
  if (!current) throw new Error('Starter plan is missing after plan catalog bootstrap')
  if (hasStarterConfig(current)) return { created: false, version: current.version }

  const latestQuery = SubscriptionPlan.findOne({ planId: 'starter' }).sort({ version: -1 }).lean()
  if (session) latestQuery.session(session)
  const latest = await latestQuery
  const now = new Date()
  const nextVersion = Number(latest?.version || current.version || 1) + 1
  const snapshot = current.toObject()

  await SubscriptionPlan.updateMany(
    { planId: 'starter', isCurrent: true },
    { $set: { isCurrent: false, effectiveTo: now } },
    session ? { session } : undefined,
  )

  await SubscriptionPlan.create([{
    ...snapshot,
    _id: undefined,
    __v: undefined,
    createdAt: undefined,
    updatedAt: undefined,
    planId: 'starter',
    version: nextVersion,
    features: starterFeatures(snapshot.features),
    ...STARTER_CONFIG,
    isCurrent: true,
    isActive: true,
    effectiveFrom: now,
    effectiveTo: null,
    grandfatherExisting: true,
    migrationAppliedAt: now,
    createdBy: 'system:starter-lead-entitlement-migration',
    changeReason: 'Separate monthly lead allowance from active CRM lead capacity and introduce configurable consecutive-renewal loyalty bonuses.',
  }], session ? { session } : undefined)

  return { created: true, version: nextVersion }
}

const run = async (): Promise<void> => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  const collection = mongoose.connection.collection('subscriptionplans')
  const planCount = await collection.countDocuments({})
  if (planCount === 0) {
    if (!cli.apply) {
      console.log(`[${MIGRATION}] mode=DRY-RUN planCatalog=empty. No documents changed; fresh bootstrap already uses the Phase 9 Starter defaults.`)
      return
    }
    await SubscriptionPlanService.getAllPlans()
  }

  const missingCount = await collection.countDocuments(missingConfigFilter)
  const currentStarter = await collection.findOne({ planId: 'starter', isCurrent: true })
  const needsStarterVersion = !hasStarterConfig(currentStarter)

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} missingConfig=${missingCount} starterVersionRequired=${needsStarterVersion}`)
  console.log(`[${MIGRATION}] Starter target: base=200 bonus=50 maxBonus=500 graceDays=3 enabled=true`)

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No documents changed. Re-run with --apply after reviewing this plan.`)
    return
  }

  const backupFilter = {
    $or: [
      ...missingConfigFilter.$or,
      { planId: 'starter', isCurrent: true },
    ],
  }
  const backup = await backupDocuments({
    collection,
    filter: backupFilter,
    migrationName: MIGRATION,
    backupDir: cli.backupDir,
    projection: {
      planId: 1,
      version: 1,
      name: 1,
      features: 1,
      maxLeads: 1,
      baseMonthlyLeadAllowance: 1,
      renewalLeadBonus: 1,
      renewalBonusEnabled: 1,
      maxRenewalLeadBonus: 1,
      continuityGraceDays: 1,
      isCurrent: 1,
      effectiveFrom: 1,
      effectiveTo: 1,
      grandfatherExisting: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  })

  const supportsTransactions = await mongoSupportsTransactions()
  if (!supportsTransactions && config.isProduction) {
    throw new Error('Production Starter lead-entitlement migration requires a MongoDB replica set or mongos.')
  }

  let matchedCount = 0
  let modifiedCount = 0
  let starterVersion: { created: boolean; version?: number } = { created: false }

  const applyWrites = async (session?: ClientSession) => {
    const backfill = await neutralBackfill(session)
    matchedCount = backfill.matchedCount
    modifiedCount = backfill.modifiedCount
    starterVersion = await createStarterVersionIfNeeded(session)
  }

  if (supportsTransactions) {
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => { await applyWrites(session) })
    } finally {
      await session.endSession()
    }
  } else {
    await applyWrites()
  }

  await Cache.plans.del('catalog')
  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    missingConfigBefore: missingCount,
    neutralBackfillMatched: matchedCount,
    neutralBackfillModified: modifiedCount,
    starterVersionCreated: starterVersion.created,
    starterVersion: starterVersion.version,
    starterConfig: STARTER_CONFIG,
    existingSubscriptionPolicy: 'Existing tenants remain assigned to their immutable historical plan version; the new Starter version is used for future purchases/renewals that select it.',
    backup,
  })
  console.log(`[${MIGRATION}] completed starterVersion=${starterVersion.version ?? 'unchanged'} created=${starterVersion.created} manifest=${manifest}`)
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    RedisClient.close()
    await mongoose.disconnect().catch(() => undefined)
  })
