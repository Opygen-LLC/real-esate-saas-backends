import mongoose from 'mongoose'
import config from '../../config'
import { Cache } from '../../shared/cache'
import { backupDocuments, migrationCli, writeMigrationManifest } from './migrations/migrationSafety'
import { legacyPlanOrder, nonNegativeIntegerOrNull } from '../module/subscriptionPlan/planIdentity'

const MIGRATION = 'subscription-plan-normalization-v1'

const asRecord = (value: unknown): Record<string, any> => {
  if (value instanceof Map) return Object.fromEntries(value.entries())
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

const entitlementLeadLimit = (row: Record<string, any>): number | null => {
  const entitlements = asRecord(row.entitlements)
  const leads = asRecord(entitlements.leads)
  return nonNegativeIntegerOrNull(leads.limit)
}

const suppliedRanks = (row: Record<string, any>) => [
  nonNegativeIntegerOrNull(row.tierRank),
  nonNegativeIntegerOrNull(row.upgradeRank),
  nonNegativeIntegerOrNull(row.displayOrder),
].filter((value): value is number => value !== null)

const ranksAgree = (row: Record<string, any>) => {
  const values = suppliedRanks(row)
  return values.length < 2 || values.every((value) => value === values[0])
}

const resolvedTierRank = (row: Record<string, any>): number | null => (
  nonNegativeIntegerOrNull(row.tierRank)
  ?? nonNegativeIntegerOrNull(row.upgradeRank)
  ?? nonNegativeIntegerOrNull(row.displayOrder)
  ?? legacyPlanOrder(row.planId)
)

const activeCapacityValues = (row: Record<string, any>) => [
  nonNegativeIntegerOrNull(row.baseLeadCapacity),
  nonNegativeIntegerOrNull(row.maxLeads),
  nonNegativeIntegerOrNull(row.baseMonthlyLeadAllowance),
  entitlementLeadLimit(row),
].filter((value): value is number => value !== null)

const leadEntitlementEnabledIsConsistent = (row: Record<string, any>, capacity: number) => {
  const leads = asRecord(asRecord(row.entitlements).leads)
  return typeof leads.enabled !== 'boolean' || leads.enabled === (capacity > 0)
}

const activeCapacityStateIsConsistent = (row: Record<string, any>) => {
  const values = activeCapacityValues(row)
  return values.length > 0
    && values.every((value) => value === values[0])
    && leadEntitlementEnabledIsConsistent(row, values[0])
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
  const rows = await plans.find({}).sort({ planId: 1, version: 1 }).toArray() as Record<string, any>[]

  const blockers: string[] = []
  const skippedHistoricalLeadNormalization: string[] = []
  const changes: Array<{ row: Record<string, any>; set: Record<string, unknown> }> = []

  for (const row of rows) {
    const identity = `${String(row.planId || 'unknown')}@v${String(row.version || '?')}`
    const currentActive = row.isCurrent === true && row.isActive !== false
    const set: Record<string, unknown> = {}

    const tierRank = resolvedTierRank(row)
    if (currentActive && !ranksAgree(row)) {
      blockers.push(`${identity}: displayOrder/upgradeRank/tierRank disagree; choose one plan tier before applying Phase 1`)
    } else if (tierRank !== null && nonNegativeIntegerOrNull(row.tierRank) === null) {
      set.tierRank = tierRank
      if (currentActive) {
        // Mirroring current rows is behavior-preserving because ranksAgree was checked above.
        set.displayOrder = tierRank
        set.upgradeRank = tierRank
      }
    }

    if (String(row.leadAllowanceModel || 'paid_period_credits') === 'active_capacity') {
      if (currentActive && !activeCapacityStateIsConsistent(row)) {
        blockers.push(`${identity}: active-capacity lead fields disagree; refusing to change commercial limits automatically`)
      } else if (activeCapacityStateIsConsistent(row)) {
        const baseLeadCapacity = activeCapacityValues(row)[0]
        if (nonNegativeIntegerOrNull(row.baseLeadCapacity) === null) set.baseLeadCapacity = baseLeadCapacity
        if (currentActive) {
          set.maxLeads = baseLeadCapacity
          set.baseMonthlyLeadAllowance = baseLeadCapacity
          const entitlements = asRecord(row.entitlements)
          set.entitlements = {
            ...entitlements,
            leads: { enabled: baseLeadCapacity > 0, limit: baseLeadCapacity },
          }
        }
      } else if (!currentActive) {
        skippedHistoricalLeadNormalization.push(identity)
      }
    } else if (nonNegativeIntegerOrNull(row.baseLeadCapacity) === null) {
      // Legacy paid-period-credit plans intentionally had two different lead concepts.
      // Preserve immutable history; the API exposes a read fallback without rewriting them.
      skippedHistoricalLeadNormalization.push(identity)
    }

    if (Object.keys(set).length) changes.push({ row, set })
  }

  const currentTierOwners = new Map<number, string>()
  for (const row of rows.filter((item) => item.isCurrent === true && item.isActive !== false)) {
    const tierRank = resolvedTierRank(row)
    if (tierRank === null) {
      blockers.push(`${String(row.planId)}@v${String(row.version)}: no valid plan tier can be resolved`)
      continue
    }
    const owner = currentTierOwners.get(tierRank)
    if (owner && owner !== String(row.planId)) blockers.push(`tier ${tierRank} is shared by current plans ${owner} and ${String(row.planId)}`)
    currentTierOwners.set(tierRank, String(row.planId))
  }

  console.log(JSON.stringify({
    migration: MIGRATION,
    mode: cli.apply ? 'APPLY' : 'DRY-RUN',
    planVersions: rows.length,
    versionsToBackfill: changes.length,
    currentTierAssignments: Object.fromEntries([...currentTierOwners.entries()].map(([rank, planId]) => [planId, rank])),
    skippedHistoricalLeadNormalization,
    blockers,
    commercialPriceMutation: false,
    tenantAssignmentMutation: false,
    historicalVersionRewrite: false,
  }, null, 2))

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data changed. Resolve any blockers, then re-run with --apply.`)
    return
  }
  if (blockers.length) throw new Error(`Refusing Phase 1 normalization because ${blockers.length} blocker(s) remain:\n- ${blockers.join('\n- ')}`)

  const planBackup = await backupDocuments({
    collection: plans,
    filter: {},
    migrationName: MIGRATION,
    backupDir: cli.backupDir,
  })

  let modifiedPlanVersions = 0
  for (const { row, set } of changes) {
    const result = await plans.updateOne({ _id: row._id }, { $set: set })
    modifiedPlanVersions += result.modifiedCount
  }

  await plans.createIndex(
    { tierRank: 1 },
    {
      name: 'current_active_tier_rank_unique',
      unique: true,
      partialFilterExpression: { isCurrent: true, isActive: true, tierRank: { $type: 'number' } },
    },
  )

  await Cache.plans.del('catalog')
  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    planBackup,
    modifiedPlanVersions,
    skippedHistoricalLeadNormalization,
    tenantAssignmentMutation: false,
    commercialPriceMutation: false,
    fieldsBackfilled: ['tierRank', 'baseLeadCapacity'],
    compatibilityMirrorsOnCurrentSafeRows: ['displayOrder', 'upgradeRank', 'maxLeads', 'baseMonthlyLeadAllowance', 'entitlements.leads'],
  })

  console.log(`[${MIGRATION}] completed modifiedPlanVersions=${modifiedPlanVersions} manifest=${manifest}`)
}

run()
  .catch((error) => {
    console.error(`[${MIGRATION}] failed`, error)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined)
  })
