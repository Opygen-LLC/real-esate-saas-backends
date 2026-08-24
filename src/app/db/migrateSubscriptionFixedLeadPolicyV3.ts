import mongoose, { ClientSession } from 'mongoose'
import config from '../../config'
import { Cache } from '../../shared/cache'
import { mongoSupportsTransactions } from './mongoCapabilities'
import { backupDocuments, migrationCli, writeMigrationManifest } from './migrations/migrationSafety'
import { mirrorTierRankWrite } from '../module/subscriptionPlan/planIdentity'
import { mirrorBaseLeadCapacityWrite } from '../module/subscriptionPlan/planLeadCapacity'
import {
  applyFixedLeadCapacityPolicyWrite,
  FIXED_LEAD_POLICY_VERSION,
  usesFixedLeadCapacityPolicy,
} from '../module/subscriptionPlan/planLeadPolicy'
import { resolvePlanStatus } from '../module/subscriptionPlan/planLifecycle'

const MIGRATION = 'subscription-fixed-lead-policy-v3'
const CHANGE_REASON = 'Phase 3 fixed lead capacity: renewal growth removed for new customers; existing tenant assignments remain on the grandfathered version.'

type PlanRow = Record<string, any>

const normalizeNewVersion = (current: PlanRow, nextVersion: number, now: Date): PlanRow => {
  const commercial = applyFixedLeadCapacityPolicyWrite(
    mirrorBaseLeadCapacityWrite(
      mirrorTierRankWrite({ ...current }),
    ),
  ) as PlanRow

  delete commercial._id
  delete commercial.__v
  delete commercial.createdAt
  delete commercial.updatedAt

  return {
    ...commercial,
    version: nextVersion,
    status: 'current',
    isCurrent: true,
    isActive: true,
    grandfatherExisting: true,
    effectiveFrom: now,
    effectiveTo: null,
    migrationAppliedAt: now,
    changeReason: CHANGE_REASON,
    createdBy: 'system:phase3-fixed-lead-policy',
    createdAt: now,
    updatedAt: now,
  }
}

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')
  const plans = db.collection('subscriptionplans')
  const organizations = db.collection('organizations')
  const rows = await plans.find({}).sort({ planId: 1, version: 1 }).toArray() as PlanRow[]
  const now = new Date()

  const families = new Map<string, PlanRow[]>()
  for (const row of rows) {
    const planId = String(row.planId || '')
    if (!planId) throw new Error(`Plan document ${String(row._id)} is missing planId`)
    families.set(planId, [...(families.get(planId) || []), row])
  }

  const replacements: Array<{ current: PlanRow; next: PlanRow; assignedTenants: number }> = []
  const blockers: string[] = []

  for (const [planId, family] of families) {
    const scheduled = family.filter((row) => resolvePlanStatus(row, now) === 'scheduled' && row.isActive !== false)
    if (scheduled.length > 0) {
      blockers.push(`${planId}: has ${scheduled.length} scheduled version(s); retire or activate them before Phase 3 migration`)
      continue
    }

    const currentRows = family.filter((row) => resolvePlanStatus(row, now) === 'current')
    if (currentRows.length > 1) {
      blockers.push(`${planId}: has ${currentRows.length} current versions`)
      continue
    }
    const current = currentRows[0]
    if (!current || usesFixedLeadCapacityPolicy(current)) continue

    const latestVersion = Math.max(...family.map((row) => Number(row.version || 0)), 0)
    const nextVersion = latestVersion + 1
    const next = normalizeNewVersion(current, nextVersion, now)
    const base = Number(next.baseLeadCapacity)
    if (!Number.isInteger(base) || base < 0) {
      blockers.push(`${planId}@v${String(current.version)}: cannot resolve a valid baseLeadCapacity`)
      continue
    }
    const tier = Number(next.tierRank)
    if (!Number.isInteger(tier) || tier < 0) {
      blockers.push(`${planId}@v${String(current.version)}: cannot resolve a valid tierRank`)
      continue
    }

    const assignedTenants = await organizations.countDocuments({
      'subscription.plan': planId,
      'subscription.planVersion': Number(current.version || 1),
    })
    replacements.push({ current, next, assignedTenants })
  }

  console.log(JSON.stringify({
    migration: MIGRATION,
    mode: cli.apply ? 'APPLY' : 'DRY-RUN',
    fixedPolicyVersion: FIXED_LEAD_POLICY_VERSION,
    planFamilies: families.size,
    currentVersionsToReplace: replacements.map(({ current, next, assignedTenants }) => ({
      planId: current.planId,
      fromVersion: current.version,
      toVersion: next.version,
      baseLeadCapacity: next.baseLeadCapacity,
      assignedTenantsPreservedOnOldVersion: assignedTenants,
    })),
    blockers,
    tenantAssignmentMutation: false,
    historicalCommercialFieldMutation: false,
    renewalGrowthResetForExistingTenants: false,
  }, null, 2))

  if (blockers.length > 0) {
    throw new Error(`Phase 3 migration blocked:\n- ${blockers.join('\n- ')}`)
  }

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data changed. Re-run with --apply after reviewing the plan-version summary.`)
    return
  }

  const planBackup = await backupDocuments({
    collection: plans,
    filter: {},
    migrationName: MIGRATION,
    backupDir: cli.backupDir,
  })

  const transactional = await mongoSupportsTransactions()
  if (!transactional && config.env === 'production') {
    throw new Error('Phase 3 fixed-capacity migration requires a MongoDB replica set or mongos in production')
  }

  const apply = async (session?: ClientSession) => {
    for (const { current, next } of replacements) {
      const updateOptions = session ? { session } : undefined
      const update = await plans.updateOne(
        { _id: current._id, $or: [{ status: 'current' }, { status: { $exists: false }, isCurrent: true }] },
        {
          $set: {
            status: 'grandfathered',
            isCurrent: false,
            isActive: true,
            grandfatherExisting: true,
            effectiveTo: now,
            migrationAppliedAt: current.migrationAppliedAt || now,
            updatedAt: now,
          },
        },
        updateOptions,
      )
      if (update.matchedCount !== 1) {
        throw new Error(`Current version changed during migration for ${String(current.planId)}@v${String(current.version)}; aborting`)
      }
      await plans.insertOne(next, updateOptions)
    }
  }

  if (transactional) {
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => apply(session))
    } finally {
      await session.endSession()
    }
  } else {
    // Non-production local/staging standalone fallback. Production is transaction-only.
    await apply()
  }

  await Cache.plans.del('catalog')

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    planBackup,
    fixedPolicyVersion: FIXED_LEAD_POLICY_VERSION,
    createdPlanVersions: replacements.map(({ current, next, assignedTenants }) => ({
      planId: current.planId,
      grandfatheredVersion: current.version,
      currentVersion: next.version,
      baseLeadCapacity: next.baseLeadCapacity,
      assignedTenantsPreservedOnGrandfatheredVersion: assignedTenants,
    })),
    tenantAssignmentMutation: false,
    historicalCommercialFieldMutation: false,
    historicalBenefitPeriodMutation: false,
    deprecatedFieldsRemovedOnlyFromNewVersions: [
      'leadAllowanceModel',
      'baseMonthlyLeadAllowance',
      'renewalLeadBonus',
      'renewalBonusEnabled',
      'maxRenewalLeadBonus',
      'continuityGraceDays',
    ],
  })

  console.log(`[${MIGRATION}] completed createdPlanVersions=${replacements.length} manifest=${manifest}`)
}

run()
  .catch((error) => {
    console.error(`[${MIGRATION}] failed`, error)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined)
  })
