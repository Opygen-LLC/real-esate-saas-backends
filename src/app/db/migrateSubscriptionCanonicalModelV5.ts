import { createHash } from 'node:crypto'
import mongoose, { ClientSession } from 'mongoose'
import config from '../../config'
import { Cache } from '../../shared/cache'
import { mongoSupportsTransactions } from './mongoCapabilities'
import { backupDocuments, migrationCli, writeMigrationManifest } from './migrations/migrationSafety'
import { applyCanonicalPlanWrite, PHASE5_FORBIDDEN_NEW_PLAN_FIELDS } from '../module/subscriptionPlan/planCanonicalWrite'
import { resolvePlanStatus } from '../module/subscriptionPlan/planLifecycle'
import { usesFixedLeadCapacityPolicy } from '../module/subscriptionPlan/planLeadPolicy'

const MIGRATION = 'subscription-canonical-model-v5'
const CHANGE_REASON = 'Phase 5 canonical subscription model: simplified fixed lead capacity and recurring add-on scaling; existing tenant assignments remain grandfathered.'

type PlanRow = Record<string, any>

const canonicalPlanReady = (row: PlanRow): boolean => (
  Number.isInteger(Number(row.tierRank))
  && Number.isInteger(Number(row.baseLeadCapacity))
  && Number(row.baseLeadCapacity) >= 0
  && Object.prototype.hasOwnProperty.call(row, 'maxAddonLeadCapacity')
  && PHASE5_FORBIDDEN_NEW_PLAN_FIELDS.every((field) => !Object.prototype.hasOwnProperty.call(row, field))
)

const nextCanonicalVersion = (current: PlanRow, version: number, now: Date): PlanRow => {
  const next = applyCanonicalPlanWrite({ ...current }) as PlanRow
  for (const key of ['_id', '__v', 'createdAt', 'updatedAt']) delete next[key]
  for (const field of PHASE5_FORBIDDEN_NEW_PLAN_FIELDS) delete next[field]

  return {
    ...next,
    version,
    status: 'current',
    isCurrent: true,
    isActive: true,
    grandfatherExisting: true,
    effectiveFrom: now,
    effectiveTo: null,
    migrationAppliedAt: now,
    changeReason: CHANGE_REASON,
    createdBy: 'system:phase5-canonical-subscription-model',
    createdAt: now,
    updatedAt: now,
  }
}

const integrityDigest = async (collection: any, projection: Record<string, number>, session?: ClientSession) => {
  const hash = createHash('sha256')
  let count = 0
  const cursor = collection.find({}, { projection, ...(session ? { session } : {}) }).sort({ _id: 1 })
  for await (const row of cursor) {
    count += 1
    hash.update(JSON.stringify(row))
    hash.update('\n')
  }
  return { count, sha256: hash.digest('hex') }
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
  const benefitPeriods = db.collection('subscriptionbenefitperiods')
  const payments = db.collection('subscriptionpayments')
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
    if (scheduled.length) {
      blockers.push(`${planId}: has ${scheduled.length} scheduled version(s); retire or activate them before Phase 5`)
      continue
    }

    const currentRows = family.filter((row) => resolvePlanStatus(row, now) === 'current')
    if (currentRows.length > 1) {
      blockers.push(`${planId}: has ${currentRows.length} current versions`)
      continue
    }
    const current = currentRows[0]
    if (!current || canonicalPlanReady(current)) continue

    if (!usesFixedLeadCapacityPolicy(current)) {
      blockers.push(`${planId}@v${String(current.version)}: fixed-capacity Phase 3 policy must be current before Phase 5`)
      continue
    }
    const base = Number(current.baseLeadCapacity)
    if (!Number.isInteger(base) || base < 0) {
      blockers.push(`${planId}@v${String(current.version)}: baseLeadCapacity must already be canonical before Phase 5`)
      continue
    }
    const legacyLeadValues = [
      current.maxLeads,
      current.baseMonthlyLeadAllowance,
      current.entitlements?.leads?.limit,
    ].filter((value) => value !== undefined && value !== null).map(Number)
    if (legacyLeadValues.some((value) => !Number.isInteger(value) || value < 0 || value !== base)) {
      blockers.push(`${planId}@v${String(current.version)}: legacy lead values disagree with baseLeadCapacity; resolve the conflict before Phase 5`)
      continue
    }
    if (!Number.isInteger(Number(current.tierRank)) || Number(current.tierRank) < 0) {
      blockers.push(`${planId}@v${String(current.version)}: tierRank must already be canonical before Phase 5`)
      continue
    }
    if (!Object.prototype.hasOwnProperty.call(current, 'maxAddonLeadCapacity')) {
      blockers.push(`${planId}@v${String(current.version)}: maxAddonLeadCapacity must already exist before Phase 5`)
      continue
    }

    const latestVersion = Math.max(...family.map((row) => Number(row.version || 0)), 0)
    const next = nextCanonicalVersion(current, latestVersion + 1, now)
    const assignedTenants = await organizations.countDocuments({
      'subscription.plan': planId,
      'subscription.planVersion': Number(current.version || 1),
    })
    replacements.push({ current, next, assignedTenants })
  }

  const protectedIntegrity = async (session?: ClientSession) => ({
    tenantAssignments: await integrityDigest(organizations, { _id: 1, organizationId: 1, 'subscription.plan': 1, 'subscription.planVersion': 1 }, session),
    benefitPeriods: await integrityDigest(benefitPeriods, { _id: 1, organizationId: 1, paymentNumber: 1, planId: 1, planVersion: 1, totalLeadAllowance: 1, usedLeadAllowance: 1, bonusLeadAllowance: 1 }, session),
    payments: await integrityDigest(payments, { _id: 1, organizationId: 1, paymentNumber: 1, planId: 1, planVersion: 1, amount: 1, status: 1 }, session),
  })
  const integrityBefore = await protectedIntegrity()

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
      removedFromNewVersion: PHASE5_FORBIDDEN_NEW_PLAN_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(current, field)),
    })),
    blockers,
    integrityBefore,
    tenantAssignmentMutation: false,
    historicalBenefitPeriodMutation: false,
    historicalPaymentMutation: false,
    historicalCommercialFieldMutation: false,
  }, null, 2))

  if (blockers.length) throw new Error(`Phase 5 migration blocked:\n- ${blockers.join('\n- ')}`)
  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data changed. Re-run with --apply after reviewing the summary.`)
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
    throw new Error('Phase 5 canonical subscription migration requires a MongoDB replica set or mongos in production')
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

  let integrityAfter = integrityBefore
  if (transactional) {
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        const protectedBefore = await protectedIntegrity(session)
        await apply(session)
        const protectedAfter = await protectedIntegrity(session)
        if (JSON.stringify(protectedBefore) !== JSON.stringify(protectedAfter)) {
          throw new Error(`Phase 5 integrity verification failed inside the transaction. before=${JSON.stringify(protectedBefore)} after=${JSON.stringify(protectedAfter)}`)
        }
        integrityAfter = protectedAfter
      })
    } finally {
      await session.endSession()
    }
  } else {
    const protectedBefore = await protectedIntegrity()
    await apply()
    const protectedAfter = await protectedIntegrity()
    if (JSON.stringify(protectedBefore) !== JSON.stringify(protectedAfter)) {
      throw new Error(`Phase 5 integrity verification failed. before=${JSON.stringify(protectedBefore)} after=${JSON.stringify(protectedAfter)}`)
    }
    integrityAfter = protectedAfter
  }

  await Cache.plans.del('catalog')

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    planBackup,
    createdPlanVersions: replacements.map(({ current, next, assignedTenants }) => ({
      planId: current.planId,
      grandfatheredVersion: current.version,
      currentVersion: next.version,
      baseLeadCapacity: next.baseLeadCapacity,
      maxAddonLeadCapacity: next.maxAddonLeadCapacity,
      assignedTenantsPreservedOnGrandfatheredVersion: assignedTenants,
    })),
    canonicalNewWriteFields: ['tierRank', 'baseLeadCapacity', 'maxAddonLeadCapacity', 'status'],
    legacyFieldsRemovedOnlyFromNewVersions: PHASE5_FORBIDDEN_NEW_PLAN_FIELDS,
    tenantAssignmentMutation: false,
    historicalBenefitPeriodMutation: false,
    historicalPaymentMutation: false,
    historicalCommercialFieldMutation: false,
    integrityBefore,
    integrityAfter,
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
