import crypto from 'crypto'
import mongoose, { type ClientSession } from 'mongoose'
import config from '../../config'
import { Cache } from '../../shared/cache'
import { RedisClient } from '../../shared/redisClient'
import { Organization } from '../module/organization/organization.model'
import { SubscriptionPlan } from '../module/subscriptionPlan/subscriptionPlan.model'
import { SubscriptionPlanService } from '../module/subscriptionPlan/subscriptionPlan.service'
import { mongoSupportsTransactions } from './mongoCapabilities'
import { backupDocuments, migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'subscription-tier-rollover-v2'

type TargetPlan = {
  planId: 'starter' | 'professional' | 'agency'
  version: number
  name: string
  priceMonthly: number
  priceYearly: number
  maxAgents: number
  maxProperties: number
  maxStorageMb: number
  baseMonthlyLeadAllowance: number
  renewalLeadBonus: number
}

const TARGETS: readonly TargetPlan[] = [
  {
    planId: 'starter',
    version: 6,
    name: 'Starter',
    priceMonthly: 500,
    priceYearly: 5000,
    baseMonthlyLeadAllowance: 200,
    renewalLeadBonus: 50,
    maxAgents: 3,
    maxProperties: 10,
    maxStorageMb: 1024,
  },
  {
    planId: 'professional',
    version: 4,
    name: 'Professional',
    priceMonthly: 1000,
    priceYearly: 10000,
    baseMonthlyLeadAllowance: 800,
    renewalLeadBonus: 100,
    maxAgents: 5,
    maxProperties: 25,
    maxStorageMb: 1024,
  },
  {
    planId: 'agency',
    version: 4,
    name: 'Agency Scale',
    priceMonthly: 1500,
    priceYearly: 15000,
    baseMonthlyLeadAllowance: 2000,
    renewalLeadBonus: 200,
    maxAgents: 10,
    maxProperties: 50,
    maxStorageMb: 5120,
  },
] as const

const targetSnapshot = (target: TargetPlan) => ({
  planId: target.planId,
  version: target.version,
  name: target.name,
  priceMonthly: target.priceMonthly,
  priceYearly: target.priceYearly,
  currency: 'BDT',
  maxAgents: target.maxAgents,
  maxProperties: target.maxProperties,
  // For active-capacity versions maxLeads remains the base fallback. The live entitlement
  // resolver replaces it with the current benefit period's cumulative capacity.
  maxLeads: target.baseMonthlyLeadAllowance,
  maxStorageMb: target.maxStorageMb,
  leadAllowanceModel: 'active_capacity',
  baseMonthlyLeadAllowance: target.baseMonthlyLeadAllowance,
  renewalLeadBonus: target.renewalLeadBonus,
  renewalBonusEnabled: true,
  // Zero is the explicit unlimited sentinel. Historical versions with positive caps stay capped.
  maxRenewalLeadBonus: 0,
  continuityGraceDays: 3,
  grandfatherExisting: true,
  isActive: true,
  isCurrent: true,
}) as const

const hasTargetPolicy = (plan: any, target: TargetPlan): boolean => {
  const expected = targetSnapshot(target)
  return Boolean(plan)
    && String(plan.planId) === expected.planId
    && Number(plan.version) === expected.version
    && String(plan.name) === expected.name
    && Number(plan.priceMonthly) === expected.priceMonthly
    && Number(plan.priceYearly) === expected.priceYearly
    && String(plan.currency) === expected.currency
    && Number(plan.maxAgents) === expected.maxAgents
    && Number(plan.maxProperties) === expected.maxProperties
    && Number(plan.maxLeads) === expected.maxLeads
    && Number(plan.maxStorageMb) === expected.maxStorageMb
    && String(plan.leadAllowanceModel || 'paid_period_credits') === expected.leadAllowanceModel
    && Number(plan.baseMonthlyLeadAllowance) === expected.baseMonthlyLeadAllowance
    && Number(plan.renewalLeadBonus) === expected.renewalLeadBonus
    && plan.renewalBonusEnabled === expected.renewalBonusEnabled
    && Number(plan.maxRenewalLeadBonus) === expected.maxRenewalLeadBonus
    && Number(plan.continuityGraceDays) === expected.continuityGraceDays
    && plan.grandfatherExisting === expected.grandfatherExisting
    && plan.isActive === expected.isActive
    && plan.isCurrent === expected.isCurrent
}

const resourceFeatures = (target: TargetPlan, features: unknown): string[] => {
  const source = Array.isArray(features) ? features.map(String) : []
  const filtered = source.filter((feature) => {
    const value = feature.toLowerCase()
    return !value.includes('team agent')
      && !value.includes('team member')
      && !value.includes('property listing')
      && !value.includes('listings')
      && !value.includes('lead')
      && !value.includes('storage')
      && !value.includes('consecutive renewal')
      && !value.includes('renewal growth')
  })
  return [
    `${target.maxAgents} Team Members`,
    `${target.maxProperties} Property Listings`,
    `${target.baseMonthlyLeadAllowance.toLocaleString('en-US')} Initial Active Leads`,
    `+${target.renewalLeadBonus.toLocaleString('en-US')} Active Leads per Consecutive Monthly Renewal`,
    `${target.maxStorageMb.toLocaleString('en-US')} MB Storage`,
    ...filtered,
  ]
}

const assignedPlanFingerprint = async (session?: ClientSession): Promise<{ count: number; sha256: string }> => {
  const query = Organization.find({})
    .sort({ _id: 1 })
    .select('_id organizationId subscription.plan subscription.planVersion')
    .lean()
  if (session) query.session(session)
  const rows: any[] = await query
  const hash = crypto.createHash('sha256')
  for (const row of rows) {
    hash.update(`${String(row._id)}\t${String(row.organizationId || '')}\t${String(row.subscription?.plan || '')}\t${Number(row.subscription?.planVersion || 0)}\n`)
  }
  return { count: rows.length, sha256: hash.digest('hex') }
}

const getLatest = async (planId: string, session?: ClientSession) => {
  const query = SubscriptionPlan.findOne({ planId }).sort({ version: -1 })
  if (session) query.session(session)
  return query
}

const getCurrent = async (planId: string, session?: ClientSession) => {
  const query = SubscriptionPlan.findOne({ planId, isCurrent: true }).sort({ version: -1 })
  if (session) query.session(session)
  return query
}

const getTarget = async (target: TargetPlan, session?: ClientSession) => {
  const query = SubscriptionPlan.findOne({ planId: target.planId, version: target.version })
  if (session) query.session(session)
  return query
}

const validateTargetSlot = async (target: TargetPlan, session?: ClientSession) => {
  const [existingTarget, latest, current] = await Promise.all([
    getTarget(target, session),
    getLatest(target.planId, session),
    getCurrent(target.planId, session),
  ])

  if (existingTarget) {
    if (!hasTargetPolicy(existingTarget, target)) {
      throw new Error(
        `${target.planId} v${target.version} already exists with different commercial data. `
        + 'Refusing to overwrite an immutable historical plan version.',
      )
    }
    if (latest && Number(latest.version) > target.version) {
      throw new Error(
        `${target.planId} already has v${latest.version}, newer than requested v${target.version}. `
        + 'Refusing to rewrite catalog history.',
      )
    }
    return { state: 'already-applied' as const, currentVersion: Number(current?.version || existingTarget.version) }
  }

  if (!current) throw new Error(`${target.planId} current plan is missing after catalog bootstrap`)
  if (latest && Number(latest.version) >= target.version) {
    throw new Error(
      `${target.planId} latest version is v${latest.version} but target v${target.version} is missing. `
      + 'Refusing to fill or overwrite an immutable historical version slot.',
    )
  }

  return { state: 'create' as const, currentVersion: Number(current.version || 0) }
}

const createTargetVersion = async (target: TargetPlan, session?: ClientSession) => {
  const slot = await validateTargetSlot(target, session)
  if (slot.state === 'already-applied') {
    return { created: false, previousVersion: slot.currentVersion, version: target.version }
  }

  const current = await getCurrent(target.planId, session)
  if (!current) throw new Error(`${target.planId} current plan disappeared during migration`)

  const now = new Date()
  const snapshot = current.toObject()
  current.isCurrent = false
  current.effectiveTo = now
  await current.save(session ? { session } : undefined)

  const expected = targetSnapshot(target)
  await SubscriptionPlan.create([{
    ...snapshot,
    _id: undefined,
    __v: undefined,
    createdAt: undefined,
    updatedAt: undefined,
    ...expected,
    features: resourceFeatures(target, snapshot.features),
    effectiveFrom: now,
    effectiveTo: null,
    migrationAppliedAt: now,
    createdBy: `system:${MIGRATION}`,
    changeReason: `${target.name} immutable rollover: ${target.baseMonthlyLeadAllowance} active leads +${target.renewalLeadBonus} per consecutive monthly renewal; existing tenant planVersion assignments remain grandfathered.`,
  }], session ? { session } : undefined)

  return { created: true, previousVersion: Number(current.version || 0), version: target.version }
}

const run = async (): Promise<void> => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  try {
    let catalogCount = await SubscriptionPlan.countDocuments({})
    if (!catalogCount && cli.apply) {
      // Bootstrap outside the migration transaction so its snapshot cannot depend on writes
      // performed through a different session.
      await SubscriptionPlanService.getAllPlans()
      catalogCount = await SubscriptionPlan.countDocuments({})
    }

    const dryStates = [] as Array<Record<string, unknown>>
    for (const target of TARGETS) {
      const existingTarget = await SubscriptionPlan.findOne({ planId: target.planId, version: target.version }).lean()
      const latest = await SubscriptionPlan.findOne({ planId: target.planId }).sort({ version: -1 }).lean()
      const current = await SubscriptionPlan.findOne({ planId: target.planId, isCurrent: true }).sort({ version: -1 }).lean()
      const state = existingTarget
        ? (hasTargetPolicy(existingTarget, target) ? 'already-applied' : 'conflict')
        : (latest && Number((latest as any).version) >= target.version ? 'immutable-version-gap-conflict' : 'create')
      dryStates.push({
        planId: target.planId,
        targetVersion: target.version,
        currentVersion: (current as any)?.version ?? null,
        latestVersion: (latest as any)?.version ?? null,
        state,
      })
    }

    console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} catalogCount=${catalogCount}`)
    for (const target of TARGETS) {
      console.log(
        `[${MIGRATION}] ${target.planId} v${target.version}: monthly=${target.priceMonthly} yearly=${target.priceYearly} `
        + `baseCapacity=${target.baseMonthlyLeadAllowance} monthlyRenewalIncrease=${target.renewalLeadBonus} `
        + `team=${target.maxAgents} listings=${target.maxProperties} storageMb=${target.maxStorageMb} maxBonus=unlimited`,
      )
    }
    console.log(`[${MIGRATION}] tenantPolicy=grandfather existing Organization.subscription.planVersion assignments; normal renewals remain pinned to the assigned version`)

    if (!cli.apply) {
      console.log(`[${MIGRATION}] plan=${JSON.stringify(dryStates)}`)
      console.log(`[${MIGRATION}] No documents changed. Re-run with --apply after reviewing this plan.`)
      return
    }

    const conflicting = dryStates.filter((state) => ['conflict', 'immutable-version-gap-conflict'].includes(String(state.state)))
    if (conflicting.length) {
      throw new Error(`Immutable plan-version safety check failed: ${JSON.stringify(conflicting)}`)
    }

    const collection = mongoose.connection.collection('subscriptionplans')
    const backup = await backupDocuments({
      collection,
      filter: { planId: { $in: TARGETS.map((target) => target.planId) } },
      migrationName: MIGRATION,
      backupDir: cli.backupDir,
      projection: {
        planId: 1,
        version: 1,
        name: 1,
        priceMonthly: 1,
        priceYearly: 1,
        currency: 1,
        features: 1,
        maxAgents: 1,
        maxProperties: 1,
        maxLeads: 1,
        maxStorageMb: 1,
        leadAllowanceModel: 1,
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
      throw new Error('Production subscription tier rollover migration requires a MongoDB replica set or mongos.')
    }

    let assignmentBefore: { count: number; sha256: string } | undefined
    let assignmentAfter: { count: number; sha256: string } | undefined
    const results: Array<{ planId: string; created: boolean; previousVersion: number; version: number }> = []

    const applyWrites = async (session?: ClientSession) => {
      assignmentBefore = await assignedPlanFingerprint(session)
      for (const target of TARGETS) {
        const result = await createTargetVersion(target, session)
        results.push({ planId: target.planId, ...result })
      }
      assignmentAfter = await assignedPlanFingerprint(session)
      if (assignmentBefore.count !== assignmentAfter.count || assignmentBefore.sha256 !== assignmentAfter.sha256) {
        throw new Error(
          'Organization.subscription plan/version assignment fingerprint changed during migration. '
          + 'Aborting to preserve grandfathered tenant assignments.',
        )
      }
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

    // Post-commit verification: every target must be current and exact. This check never mutates.
    for (const target of TARGETS) {
      const persisted = await SubscriptionPlan.findOne({ planId: target.planId, version: target.version }).lean()
      if (!hasTargetPolicy(persisted, target)) {
        throw new Error(`${target.planId} v${target.version} failed post-migration policy verification`)
      }
    }

    const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
      targets: TARGETS.map((target) => targetSnapshot(target)),
      results,
      existingTenantPolicy: 'No Organization.subscription.plan or planVersion assignments are written. Existing paid tenants remain pinned until an explicit plan change/new-plan acceptance.',
      normalRenewalPolicy: 'Manual and bKash same-plan renewals resolve the Organization assigned immutable planVersion instead of the latest current catalog version.',
      yearlyLeadPolicy: 'Yearly billing starts at the tier base active-lead capacity and does not multiply capacity by 12 or advance the monthly renewal streak.',
      unlimitedBonusSentinel: 'maxRenewalLeadBonus=0 means unlimited cumulative renewal growth; historical positive caps remain capped.',
      organizationAssignmentFingerprintBefore: assignmentBefore,
      organizationAssignmentFingerprintAfter: assignmentAfter,
      backup,
    })

    console.log(`[${MIGRATION}] completed results=${JSON.stringify(results)} manifest=${manifest}`)
  } finally {
    RedisClient.close()
    await mongoose.disconnect().catch(() => undefined)
  }
}

run().catch((error: unknown) => {
  console.error(`[${MIGRATION}] failed:`, error instanceof Error ? error.message : error)
  process.exitCode = 1
})
