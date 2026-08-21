import crypto from 'crypto'
import mongoose, { type ClientSession } from 'mongoose'
import config from '../../config'
import { Cache } from '../../shared/cache'
import { RedisClient } from '../../shared/redisClient'
import { Organization } from '../module/organization/organization.model'
import { SubscriptionPlan } from '../module/subscriptionPlan/subscriptionPlan.model'
import { SubscriptionPlanService } from '../module/subscriptionPlan/subscriptionPlan.service'
import type { SubscriptionPlanId } from '../module/subscriptionPlan/subscriptionPlan.interface'
import { mongoSupportsTransactions } from './mongoCapabilities'
import { backupDocuments, migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'subscription-lead-release-v1'
const LEAD_LOCK_INDEX = 'lead_tenant_lock_created'
const LEAD_LOCK_INDEX_KEY = { organizationId: 1, isLocked: 1, createdAt: -1, _id: -1 } as const

type TargetPlan = {
  planId: Extract<SubscriptionPlanId, 'starter' | 'professional' | 'agency'>
  version: number
  name: string
  priceMonthly: number
  priceYearly: number
  baseLeadCapacity: number
  renewalLeadBonus: number
  maxAgents: number
  maxProperties: number
  maxStorageMb: number
}

const TARGETS: readonly TargetPlan[] = [
  { planId: 'starter', version: 6, name: 'Starter', priceMonthly: 500, priceYearly: 5000, baseLeadCapacity: 200, renewalLeadBonus: 50, maxAgents: 3, maxProperties: 10, maxStorageMb: 1024 },
  { planId: 'professional', version: 4, name: 'Professional', priceMonthly: 1000, priceYearly: 10000, baseLeadCapacity: 800, renewalLeadBonus: 100, maxAgents: 5, maxProperties: 25, maxStorageMb: 1024 },
  { planId: 'agency', version: 4, name: 'Agency Scale', priceMonthly: 1500, priceYearly: 15000, baseLeadCapacity: 2000, renewalLeadBonus: 200, maxAgents: 10, maxProperties: 50, maxStorageMb: 5120 },
] as const

const targetCommercialSnapshot = (target: TargetPlan) => ({
  planId: target.planId,
  version: target.version,
  name: target.name,
  priceMonthly: target.priceMonthly,
  priceYearly: target.priceYearly,
  currency: 'BDT',
  maxAgents: target.maxAgents,
  maxProperties: target.maxProperties,
  maxLeads: target.baseLeadCapacity,
  maxStorageMb: target.maxStorageMb,
  leadAllowanceModel: 'active_capacity',
  baseMonthlyLeadAllowance: target.baseLeadCapacity,
  renewalLeadBonus: target.renewalLeadBonus,
  renewalBonusEnabled: true,
  maxRenewalLeadBonus: 0,
  continuityGraceDays: 3,
  grandfatherExisting: true,
  isActive: true,
}) as const

const hasCommercialPolicy = (plan: any, target: TargetPlan): boolean => {
  if (!plan) return false
  const expected = targetCommercialSnapshot(target)
  return String(plan.planId) === expected.planId
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
    && plan.grandfatherExisting === true
    && plan.isActive === true
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
    `${target.baseLeadCapacity.toLocaleString('en-US')} Initial Active Leads`,
    `+${target.renewalLeadBonus.toLocaleString('en-US')} Active Leads per Consecutive Monthly Renewal`,
    `${target.maxStorageMb.toLocaleString('en-US')} MB Storage`,
    ...filtered,
  ]
}

const assignmentFingerprint = async (session?: ClientSession): Promise<{ count: number; sha256: string }> => {
  const query = Organization.find({}).sort({ _id: 1 }).select('_id organizationId subscription.plan subscription.planVersion').lean()
  if (session) query.session(session)
  const rows: any[] = await query
  const hash = crypto.createHash('sha256')
  for (const row of rows) {
    hash.update(`${String(row._id)}\t${String(row.organizationId || '')}\t${String(row.subscription?.plan || '')}\t${Number(row.subscription?.planVersion || 0)}\n`)
  }
  return { count: rows.length, sha256: hash.digest('hex') }
}

const targetAssignmentClauses = TARGETS.map((target) => ({
  'subscription.plan': target.planId,
  'subscription.planVersion': target.version,
}))

const grandfatheredOrganizationIds = async (): Promise<string[]> => {
  const rows: any[] = await Organization.find({ $nor: targetAssignmentClauses }).select('organizationId').lean()
  return rows.map((row) => String(row.organizationId || '')).filter(Boolean)
}

const targetState = async (target: TargetPlan) => {
  const [existing, current, latest] = await Promise.all([
    SubscriptionPlan.findOne({ planId: target.planId, version: target.version }).lean(),
    SubscriptionPlan.findOne({ planId: target.planId, isCurrent: true }).sort({ version: -1 }).lean(),
    SubscriptionPlan.findOne({ planId: target.planId }).sort({ version: -1 }).lean(),
  ])
  if (existing && !hasCommercialPolicy(existing, target)) return { state: 'conflict', existing, current, latest }
  if (latest && Number((latest as any).version) > target.version) return { state: 'newer-version-conflict', existing, current, latest }
  if (existing) return { state: (existing as any).isCurrent ? 'ready' : 'repair-current', existing, current, latest }
  if (latest && Number((latest as any).version) >= target.version) return { state: 'immutable-slot-conflict', existing, current, latest }
  return { state: 'create', existing, current, latest }
}

const applyTarget = async (target: TargetPlan, session?: ClientSession) => {
  const existingQuery = SubscriptionPlan.findOne({ planId: target.planId, version: target.version })
  if (session) existingQuery.session(session)
  const existing: any = await existingQuery
  const latestQuery = SubscriptionPlan.findOne({ planId: target.planId }).sort({ version: -1 })
  if (session) latestQuery.session(session)
  const latest: any = await latestQuery

  if (latest && Number(latest.version) > target.version) {
    throw new Error(`${target.planId} already has newer v${latest.version}; refusing to make historical v${target.version} current`)
  }
  if (existing && !hasCommercialPolicy(existing, target)) {
    throw new Error(`${target.planId} v${target.version} exists with different commercial terms; immutable versions are never overwritten`)
  }

  const currentQuery = SubscriptionPlan.findOne({ planId: target.planId, isCurrent: true }).sort({ version: -1 })
  if (session) currentQuery.session(session)
  const current: any = await currentQuery
  const now = new Date()

  if (!existing) {
    if (!current) throw new Error(`${target.planId} has no current plan version to clone`)
    if (Number(current.version) >= target.version) throw new Error(`${target.planId} cannot create target v${target.version} from current v${current.version}`)
    const snapshot = current.toObject()
    await SubscriptionPlan.updateMany(
      { planId: target.planId, isCurrent: true },
      { $set: { isCurrent: false, effectiveTo: now } },
      session ? { session } : undefined,
    )
    await SubscriptionPlan.create([{
      ...snapshot,
      _id: undefined,
      __v: undefined,
      createdAt: undefined,
      updatedAt: undefined,
      ...targetCommercialSnapshot(target),
      isCurrent: true,
      features: resourceFeatures(target, snapshot.features),
      effectiveFrom: now,
      effectiveTo: null,
      migrationAppliedAt: now,
      createdBy: `system:${MIGRATION}`,
      changeReason: `${target.name} production release: cumulative active lead capacity with immutable grandfathering.`,
    }], session ? { session } : undefined)
    return { planId: target.planId, version: target.version, action: 'created' }
  }

  // isCurrent/effectiveTo are catalog lifecycle metadata, not immutable commercial terms.
  // Old versions remain isActive=true so exact-version grandfathered lookups continue to work.
  await SubscriptionPlan.updateMany(
    { planId: target.planId, version: { $ne: target.version }, isCurrent: true },
    { $set: { isCurrent: false, effectiveTo: now } },
    session ? { session } : undefined,
  )
  await SubscriptionPlan.updateOne(
    { _id: existing._id },
    { $set: { isCurrent: true, isActive: true, effectiveTo: null } },
    session ? { session } : undefined,
  )
  return { planId: target.planId, version: target.version, action: existing.isCurrent ? 'verified' : 'made-current' }
}

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  try {
    if (cli.apply && !(await SubscriptionPlan.exists({}))) await SubscriptionPlanService.getAllPlans()
    const db = mongoose.connection.db
    if (!db) throw new Error('MongoDB connection is unavailable')
    const leads = db.collection('leads')

    const states = await Promise.all(TARGETS.map(async (target) => {
      const state = await targetState(target)
      return {
        planId: target.planId,
        targetVersion: target.version,
        state: state.state,
        currentVersion: Number((state.current as any)?.version || 0) || null,
        latestVersion: Number((state.latest as any)?.version || 0) || null,
      }
    }))
    const conflicts = states.filter((row) => String(row.state).includes('conflict'))
    const grandfatheredIds = await grandfatheredOrganizationIds()
    const missingLockState = await leads.countDocuments({ isLocked: { $exists: false } })
    let grandfatheredSubscriptionLocks = 0
    for (let index = 0; index < grandfatheredIds.length; index += 500) {
      grandfatheredSubscriptionLocks += await leads.countDocuments({
        organizationId: { $in: grandfatheredIds.slice(index, index + 500) },
        isLocked: true,
        lockReason: 'subscription_limit',
      })
    }
    const indexes = await leads.indexes().catch(() => [])
    const leadLockIndex: any = indexes.find((index) => index.name === LEAD_LOCK_INDEX)
    if (leadLockIndex && JSON.stringify(leadLockIndex.key) !== JSON.stringify(LEAD_LOCK_INDEX_KEY)) {
      throw new Error(`Refusing to replace conflicting ${LEAD_LOCK_INDEX}: ${JSON.stringify(leadLockIndex.key)}`)
    }

    console.log(JSON.stringify({
      migration: MIGRATION,
      mode: cli.apply ? 'APPLY' : 'DRY-RUN',
      targets: states,
      grandfatheredOrganizations: grandfatheredIds.length,
      leadsMissingIsLocked: missingLockState,
      grandfatheredSubscriptionLocks,
      leadLockIndexPresent: Boolean(leadLockIndex),
      tenantPlanVersionMutation: false,
      leadDeletion: false,
    }, null, 2))

    if (conflicts.length) throw new Error(`Immutable subscription catalog conflict: ${JSON.stringify(conflicts)}`)
    if (!cli.apply) {
      console.log(`[${MIGRATION}] No documents changed. Re-run with --apply after reviewing the release plan.`)
      return
    }

    const supportsTransactions = await mongoSupportsTransactions()
    if (!supportsTransactions && config.isProduction) {
      throw new Error('Production subscription release migration requires a MongoDB replica set or mongos')
    }

    const planBackup = await backupDocuments({
      collection: db.collection('subscriptionplans'),
      filter: { planId: { $in: TARGETS.map((target) => target.planId) } },
      migrationName: MIGRATION,
      backupDir: cli.backupDir,
    })
    const leadBackup = await backupDocuments({
      collection: leads,
      filter: { $or: [{ isLocked: { $exists: false } }, { isLocked: true, lockReason: 'subscription_limit' }] },
      projection: { _id: 1, organizationId: 1, isLocked: 1, lockReason: 1, lockedAt: 1, lockedBy: 1, createdAt: 1 },
      migrationName: MIGRATION,
      backupDir: cli.backupDir,
    })

    let assignmentBefore: { count: number; sha256: string } | undefined
    let assignmentAfter: { count: number; sha256: string } | undefined
    const planResults: Array<Record<string, unknown>> = []
    const applyPlans = async (session?: ClientSession) => {
      assignmentBefore = await assignmentFingerprint(session)
      for (const target of TARGETS) planResults.push(await applyTarget(target, session))
      assignmentAfter = await assignmentFingerprint(session)
      if (assignmentBefore.count !== assignmentAfter.count || assignmentBefore.sha256 !== assignmentAfter.sha256) {
        throw new Error('Organization.subscription plan/version fingerprint changed; refusing to break grandfathering')
      }
    }

    if (supportsTransactions) {
      const session = await mongoose.startSession()
      try {
        await session.withTransaction(async () => { await applyPlans(session) })
      } finally {
        await session.endSession()
      }
    } else await applyPlans()

    const leadCountBefore = await leads.countDocuments({})
    const missingBackfill = await leads.updateMany(
      { isLocked: { $exists: false } },
      { $set: { isLocked: false }, $unset: { lockReason: '', lockedAt: '', lockedBy: '' } },
    )
    let grandfatheredUnlocked = 0
    for (let index = 0; index < grandfatheredIds.length; index += 500) {
      const result = await leads.updateMany(
        {
          organizationId: { $in: grandfatheredIds.slice(index, index + 500) },
          isLocked: true,
          lockReason: 'subscription_limit',
        },
        { $set: { isLocked: false }, $unset: { lockReason: '', lockedAt: '', lockedBy: '' } },
      )
      grandfatheredUnlocked += Number(result.modifiedCount || 0)
    }
    await leads.createIndex(LEAD_LOCK_INDEX_KEY, { name: LEAD_LOCK_INDEX })
    const leadCountAfter = await leads.countDocuments({})
    if (leadCountAfter !== leadCountBefore) throw new Error('Lead count changed during release migration; no Lead may be deleted or inserted')

    for (const target of TARGETS) {
      const persisted: any = await SubscriptionPlan.findOne({ planId: target.planId, version: target.version }).lean()
      if (!hasCommercialPolicy(persisted, target) || persisted.isCurrent !== true || persisted.isActive !== true) {
        throw new Error(`${target.planId} v${target.version} failed release catalog verification`)
      }
      const otherCurrent = await SubscriptionPlan.countDocuments({ planId: target.planId, version: { $ne: target.version }, isCurrent: true })
      if (otherCurrent) throw new Error(`${target.planId} has ${otherCurrent} historical versions still marked current`)
    }

    const assignmentPostCommit = await assignmentFingerprint()
    if (!assignmentAfter || assignmentPostCommit.count !== assignmentAfter.count || assignmentPostCommit.sha256 !== assignmentAfter.sha256) {
      throw new Error('Organization.subscription plan/version fingerprint changed after catalog commit')
    }
    if (await leads.countDocuments({ isLocked: { $exists: false } })) throw new Error('Some Leads still have no isLocked state')
    for (let index = 0; index < grandfatheredIds.length; index += 500) {
      const locked = await leads.countDocuments({
        organizationId: { $in: grandfatheredIds.slice(index, index + 500) },
        isLocked: true,
        lockReason: 'subscription_limit',
      })
      if (locked) throw new Error('Grandfathered tenant Leads remain subscription-locked after release backfill')
    }

    await Cache.plans.del('catalog')
    const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
      targets: TARGETS.map(targetCommercialSnapshot),
      planResults,
      planBackup,
      leadBackup,
      assignmentFingerprintBefore: assignmentBefore,
      assignmentFingerprintAfter: assignmentAfter,
      assignmentFingerprintPostCommit: assignmentPostCommit,
      leadsBackfilledFalse: Number(missingBackfill.modifiedCount || 0),
      grandfatheredSubscriptionLocksReleased: grandfatheredUnlocked,
      leadCountBefore,
      leadCountAfter,
      leadLockIndex: { name: LEAD_LOCK_INDEX, key: LEAD_LOCK_INDEX_KEY },
      tenantPlanVersionMutation: false,
      historicalVersionsRemainActive: true,
      leadDeletion: false,
      note: 'Existing grandfathered tenants remain pinned to their assigned immutable planVersion. Subscription lead locks are introduced only by active-capacity reconciliation after explicit adoption or a scheduled downgrade boundary.',
    })
    console.log(`[${MIGRATION}] completed manifest=${manifest}`)
  } finally {
    RedisClient.close()
    await mongoose.disconnect().catch(() => undefined)
  }
}

run().catch((error: unknown) => {
  console.error(`[${MIGRATION}] failed:`, error instanceof Error ? error.message : error)
  process.exitCode = 1
})
