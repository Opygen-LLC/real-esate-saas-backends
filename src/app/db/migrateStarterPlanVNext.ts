import mongoose, { ClientSession } from 'mongoose'
import config from '../../config'
import { Cache } from '../../shared/cache'
import { RedisClient } from '../../shared/redisClient'
import { SubscriptionPlan } from '../module/subscriptionPlan/subscriptionPlan.model'
import { SubscriptionPlanService } from '../module/subscriptionPlan/subscriptionPlan.service'
import { mongoSupportsTransactions } from './mongoCapabilities'
import { backupDocuments, migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'starter-plan-vnext-v1'

const STARTER_VNEXT = {
  priceMonthly: 500,
  priceYearly: 5000,
  currency: 'BDT' as const,
  maxLeads: 500,
  baseMonthlyLeadAllowance: 200,
  renewalLeadBonus: 50,
  renewalBonusEnabled: true,
  maxRenewalLeadBonus: 500,
  continuityGraceDays: 3,
} as const

const hasTargetPolicy = (plan: any): boolean =>
  Boolean(plan)
  && Number(plan.priceMonthly) === STARTER_VNEXT.priceMonthly
  && Number(plan.priceYearly) === STARTER_VNEXT.priceYearly
  && plan.currency === STARTER_VNEXT.currency
  && Number(plan.maxLeads) === STARTER_VNEXT.maxLeads
  && Number(plan.baseMonthlyLeadAllowance) === STARTER_VNEXT.baseMonthlyLeadAllowance
  && Number(plan.renewalLeadBonus) === STARTER_VNEXT.renewalLeadBonus
  && plan.renewalBonusEnabled === STARTER_VNEXT.renewalBonusEnabled
  && Number(plan.maxRenewalLeadBonus) === STARTER_VNEXT.maxRenewalLeadBonus
  && Number(plan.continuityGraceDays) === STARTER_VNEXT.continuityGraceDays
  && plan.grandfatherExisting === true

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

const getCurrentStarter = async (session?: ClientSession) => {
  const query = SubscriptionPlan.findOne({ planId: 'starter', isCurrent: true }).sort({ version: -1 })
  if (session) query.session(session)
  return query
}

const createVNextIfNeeded = async (session?: ClientSession): Promise<{ created: boolean; previousVersion: number; version: number }> => {
  const current = await getCurrentStarter(session)
  if (!current) throw new Error('Starter plan is missing after plan catalog bootstrap')
  const previousVersion = Number(current.version || 1)
  if (hasTargetPolicy(current)) {
    return { created: false, previousVersion, version: previousVersion }
  }

  const latestQuery = SubscriptionPlan.findOne({ planId: 'starter' }).sort({ version: -1 }).lean()
  if (session) latestQuery.session(session)
  const latest: any = await latestQuery
  const nextVersion = Number(latest?.version || previousVersion) + 1
  const now = new Date()
  const snapshot = current.toObject()

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
    ...STARTER_VNEXT,
    features: starterFeatures(snapshot.features),
    isCurrent: true,
    isActive: true,
    effectiveFrom: now,
    effectiveTo: null,
    // Critical Phase 14 policy: existing paid tenants stay on their assigned immutable
    // version. The plan-version worker only auto-migrates grandfatherExisting=false.
    grandfatherExisting: true,
    migrationAppliedAt: now,
    createdBy: 'system:starter-plan-vnext-migration',
    changeReason: 'Starter vNext: BDT 500/month with 200 paid-period leads and +50 monthly consecutive-renewal loyalty bonus. Existing paid tenants remain grandfathered until renewal or plan change.',
  }], session ? { session } : undefined)

  return { created: true, previousVersion, version: nextVersion }
}

const run = async (): Promise<void> => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  try {
    let current = await SubscriptionPlan.findOne({ planId: 'starter', isCurrent: true }).sort({ version: -1 }).lean()
    if (!current && cli.apply) {
      // Bootstrap outside the migration transaction so a transaction snapshot never
      // depends on catalog writes performed through a different session.
      await SubscriptionPlanService.getAllPlans()
      current = await SubscriptionPlan.findOne({ planId: 'starter', isCurrent: true }).sort({ version: -1 }).lean()
    }
    const requiresVersion = !hasTargetPolicy(current)

    console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} currentVersion=${current?.version ?? 'missing'} createVNext=${requiresVersion}`)
    console.log(`[${MIGRATION}] target monthly=500 yearly=5000 activePipeline=500 baseAllowance=200 renewalBonus=50 maxBonus=500 graceDays=3`)
    console.log(`[${MIGRATION}] tenantPolicy=grandfather existing assignments; future purchases/renewals resolve the latest current Starter version`)

    if (!cli.apply) {
      console.log(`[${MIGRATION}] No documents changed. Re-run with --apply after reviewing this plan.`)
      return
    }

    const collection = mongoose.connection.collection('subscriptionplans')
    const backup = await backupDocuments({
      collection,
      filter: { planId: 'starter' },
      migrationName: MIGRATION,
      backupDir: cli.backupDir,
      projection: {
        planId: 1,
        version: 1,
        name: 1,
        priceMonthly: 1,
        priceYearly: 1,
        currency: 1,
        maxLeads: 1,
        baseMonthlyLeadAllowance: 1,
        renewalLeadBonus: 1,
        renewalBonusEnabled: 1,
        maxRenewalLeadBonus: 1,
        continuityGraceDays: 1,
        isCurrent: 1,
        isActive: 1,
        effectiveFrom: 1,
        effectiveTo: 1,
        grandfatherExisting: 1,
        migrationAppliedAt: 1,
        createdBy: 1,
        changeReason: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    })

    const supportsTransactions = await mongoSupportsTransactions()
    if (!supportsTransactions && config.isProduction) {
      throw new Error('Production Starter vNext migration requires a MongoDB replica set or mongos.')
    }

    let result: { created: boolean; previousVersion: number; version: number } | undefined
    const applyWrites = async (session?: ClientSession) => {
      result = await createVNextIfNeeded(session)
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

    if (!result) throw new Error('Starter vNext migration did not complete')
    await Cache.plans.del('catalog')

    const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
      target: STARTER_VNEXT,
      starterVersionCreated: result.created,
      previousVersion: result.previousVersion,
      currentVersion: result.version,
      existingTenantPolicy: 'No Organization subscription assignments are modified. Existing paid tenants remain on their immutable assigned planVersion until their next renewal/change.',
      newPurchasePolicy: 'New Starter purchase/payment initiation resolves the latest current effective Starter version.',
      historicalMigrationPolicy: 'migrateStarterPlanTo500.ts is intentionally untouched and remains historical.',
      backup,
    })

    console.log(`[${MIGRATION}] completed created=${result.created} previousVersion=${result.previousVersion} currentVersion=${result.version} manifest=${manifest}`)
  } finally {
    RedisClient.close()
    await mongoose.disconnect().catch(() => undefined)
  }
}

run().catch((error: unknown) => {
  console.error(`[${MIGRATION}] failed:`, error instanceof Error ? error.message : error)
  process.exitCode = 1
})
