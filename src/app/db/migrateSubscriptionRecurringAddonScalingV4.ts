import mongoose, { ClientSession } from 'mongoose'
import config from '../../config'
import { Cache } from '../../shared/cache'
import { mongoSupportsTransactions } from './mongoCapabilities'
import { backupDocuments, migrationCli, writeMigrationManifest } from './migrations/migrationSafety'
import { applyCanonicalAddonCapacityWrite, resolveMaxAddonLeadCapacity } from '../module/subscriptionPlan/planAddonCapacity'
import { usesFixedLeadCapacityPolicy } from '../module/subscriptionPlan/planLeadPolicy'
import { resolvePlanStatus } from '../module/subscriptionPlan/planLifecycle'

const MIGRATION = 'subscription-recurring-addon-scaling-v4'
const CHANGE_REASON = 'Phase 4 recurring lead add-on scaling: canonical add-on ceilings for new plan versions; existing tenant assignments remain grandfathered.'

const RECOMMENDED_ADDON_CAPACITY: Record<string, number | null> = {
  starter: 2_000,
  professional: 5_000,
  agency: 20_000,
}

type PlanRow = Record<string, any>

const normalizeNewVersion = (current: PlanRow, nextVersion: number, now: Date): PlanRow => {
  const configuredMaximum = Object.prototype.hasOwnProperty.call(RECOMMENDED_ADDON_CAPACITY, String(current.planId || ''))
    ? RECOMMENDED_ADDON_CAPACITY[String(current.planId)]
    : resolveMaxAddonLeadCapacity(current)
  const commercial = applyCanonicalAddonCapacityWrite({
    ...current,
    maxAddonLeadCapacity: configuredMaximum,
  }) as PlanRow

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
    createdBy: 'system:phase4-recurring-addon-scaling',
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
      blockers.push(`${planId}: has ${scheduled.length} scheduled version(s); retire or activate them before Phase 4 migration`)
      continue
    }

    const currentRows = family.filter((row) => resolvePlanStatus(row, now) === 'current')
    if (currentRows.length > 1) {
      blockers.push(`${planId}: has ${currentRows.length} current versions`)
      continue
    }
    const current = currentRows[0]
    if (!current) continue

    // An existing canonical field means this family has already crossed the Phase 4 boundary.
    if (Object.prototype.hasOwnProperty.call(current, 'maxAddonLeadCapacity')) continue
    if (!usesFixedLeadCapacityPolicy(current)) {
      blockers.push(`${planId}@v${String(current.version)}: Phase 3 fixed-capacity policy must be applied before Phase 4`)
      continue
    }

    const latestVersion = Math.max(...family.map((row) => Number(row.version || 0)), 0)
    const next = normalizeNewVersion(current, latestVersion + 1, now)
    const maximum = next.maxAddonLeadCapacity
    if (maximum !== null && (!Number.isInteger(Number(maximum)) || Number(maximum) < 0)) {
      blockers.push(`${planId}@v${String(current.version)}: cannot resolve a valid maxAddonLeadCapacity`)
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
    planFamilies: families.size,
    currentVersionsToReplace: replacements.map(({ current, next, assignedTenants }) => ({
      planId: current.planId,
      fromVersion: current.version,
      toVersion: next.version,
      baseLeadCapacity: next.baseLeadCapacity,
      maxAddonLeadCapacity: next.maxAddonLeadCapacity,
      assignedTenantsPreservedOnOldVersion: assignedTenants,
    })),
    blockers,
    tenantAssignmentMutation: false,
    historicalPlanMutation: 'lifecycle-only-current-to-grandfathered',
    historicalBenefitPeriodMutation: false,
    historicalTopupGrantMutation: false,
  }, null, 2))

  if (blockers.length > 0) throw new Error(`Phase 4 migration blocked:\n- ${blockers.join('\n- ')}`)
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
    throw new Error('Phase 4 recurring add-on migration requires a MongoDB replica set or mongos in production')
  }

  const apply = async (session?: ClientSession) => {
    for (const { current, next } of replacements) {
      const options = session ? { session } : undefined
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
        options,
      )
      if (update.matchedCount !== 1) {
        throw new Error(`Current version changed during migration for ${String(current.planId)}@v${String(current.version)}; aborting`)
      }
      await plans.insertOne(next, options)
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
    await apply()
  }

  await Cache.plans.del('catalog')

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    planBackup,
    createdPlanVersions: replacements.map(({ current, next, assignedTenants }) => ({
      planId: current.planId,
      grandfatheredVersion: current.version,
      currentVersion: next.version,
      maxAddonLeadCapacity: next.maxAddonLeadCapacity,
      assignedTenantsPreservedOnGrandfatheredVersion: assignedTenants,
    })),
    tenantAssignmentMutation: false,
    historicalBenefitPeriodMutation: false,
    historicalTopupGrantMutation: false,
    canonicalField: 'maxAddonLeadCapacity',
    legacyFieldPreservedOnHistoricalVersions: 'maxRecurringLeadAddon',
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
