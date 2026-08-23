import mongoose from 'mongoose'
import config from '../../config'
import { backupDocuments, migrationCli, writeMigrationManifest } from './migrations/migrationSafety'
import { buildEntitlementsFromLegacy, FEATURE_CATALOG, mergeEntitlementConfig } from '../module/entitlement/featureCatalog'
import { ENTITLEMENT_FEATURE_IDS, type EntitlementConfig } from '../module/entitlement/entitlement.types'
import { legacyPlanOrder } from '../module/subscriptionPlan/planIdentity'
import { DEFAULT_TRIAL_POLICY } from '../module/platformSettings/trialPolicy.service'

const MIGRATION = 'subscription-entitlement-structure-v1'

const isNonNegativeInteger = (value: unknown): boolean => Number.isInteger(Number(value)) && Number(value) >= 0
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const hasCompleteEntitlementShape = (value: unknown): boolean => {
  const record = asRecord(value)
  return ENTITLEMENT_FEATURE_IDS.every((featureId) => {
    const entry = asRecord(record[featureId])
    return typeof entry.enabled === 'boolean'
  })
}

const normalizedEntitlements = (source: Record<string, any>): EntitlementConfig =>
  mergeEntitlementConfig(buildEntitlementsFromLegacy(source), source.entitlements)

const canBackfillEntitlementsWithoutGuessing = (source: Record<string, any>): boolean => {
  const persisted = asRecord(source.entitlements)
  return ENTITLEMENT_FEATURE_IDS.every((featureId) => {
    const existing = asRecord(persisted[featureId])
    if (typeof existing.enabled === 'boolean') return true
    return source[FEATURE_CATALOG[featureId].legacyField] !== undefined
  })
}

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const plans = db.collection('subscriptionplans')
  const platformSettings = db.collection('platformsettings')
  const organizations = db.collection('organizations')

  const rows = await plans.find({}).sort({ planId: 1, version: -1 }).toArray()
  const families = new Map<string, typeof rows>()
  for (const row of rows) {
    const planId = String(row.planId || '').trim().toLowerCase()
    if (!planId || planId === 'trial') continue
    const family = families.get(planId) || []
    family.push(row)
    families.set(planId, family)
  }

  const assignments = new Map<string, { displayOrder: number; upgradeRank: number }>()
  const rankOwners = new Map<number, string>()

  for (const [planId, family] of families) {
    const existingRank = family.find((row) => isNonNegativeInteger(row.upgradeRank))?.upgradeRank
    const existingOrder = family.find((row) => isNonNegativeInteger(row.displayOrder))?.displayOrder
    const legacy = legacyPlanOrder(planId)
    if (isNonNegativeInteger(existingRank) || legacy !== null) {
      const upgradeRank = isNonNegativeInteger(existingRank) ? Number(existingRank) : Number(legacy)
      const displayOrder = isNonNegativeInteger(existingOrder) ? Number(existingOrder) : Number(legacy ?? upgradeRank)
      const owner = rankOwners.get(upgradeRank)
      if (owner && owner !== planId) throw new Error(`Upgrade rank ${upgradeRank} is shared by ${owner} and ${planId}. Resolve the conflict before applying.`)
      rankOwners.set(upgradeRank, planId)
      assignments.set(planId, { displayOrder, upgradeRank })
    }
  }

  let nextRank = Math.max(0, ...Array.from(rankOwners.keys())) + 10
  const unassigned = Array.from(families.entries())
    .filter(([planId]) => !assignments.has(planId))
    .sort(([, a], [, b]) => {
      const aCurrent = a.find((row) => row.isCurrent) || a[0]
      const bCurrent = b.find((row) => row.isCurrent) || b[0]
      return Number(aCurrent?.priceMonthly || 0) - Number(bCurrent?.priceMonthly || 0)
        || String(aCurrent?.planId || '').localeCompare(String(bCurrent?.planId || ''))
    })

  for (const [planId] of unassigned) {
    while (rankOwners.has(nextRank)) nextRank += 10
    assignments.set(planId, { displayOrder: nextRank, upgradeRank: nextRank })
    rankOwners.set(nextRank, planId)
    nextRank += 10
  }

  const planChanges = rows.map((row) => {
    const assignment = assignments.get(String(row.planId || '').trim().toLowerCase())
    const set: Record<string, unknown> = {}
    if (!hasCompleteEntitlementShape(row.entitlements) && canBackfillEntitlementsWithoutGuessing(row as Record<string, any>)) {
      set.entitlements = normalizedEntitlements(row as Record<string, any>)
    }
    if (!isNonNegativeInteger(row.displayOrder) && assignment) set.displayOrder = assignment.displayOrder
    if (!isNonNegativeInteger(row.upgradeRank) && assignment) set.upgradeRank = assignment.upgradeRank
    return { row, set }
  }).filter(({ set }) => Object.keys(set).length > 0)

  const settings = await platformSettings.findOne({ key: 'platform' })
  const trial = asRecord(settings?.trial)
  const trialNeedsEntitlements = !hasCompleteEntitlementShape(trial.entitlements)
  const trialEntitlements = trialNeedsEntitlements ? normalizedEntitlements({ ...DEFAULT_TRIAL_POLICY, ...trial } as Record<string, any>) : null
  const skippedPlanEntitlementBackfills = rows.filter((row) =>
    !hasCompleteEntitlementShape(row.entitlements) && !canBackfillEntitlementsWithoutGuessing(row as Record<string, any>),
  ).map((row) => `${String(row.planId || 'unknown')}@v${String(row.version || '?')}`)
  const tenantCount = await organizations.countDocuments({})

  console.log(JSON.stringify({
    migration: MIGRATION,
    mode: cli.apply ? 'APPLY' : 'DRY-RUN',
    planVersions: rows.length,
    planFamilies: families.size,
    planVersionsNeedingStructuralBackfill: planChanges.length,
    skippedPlanEntitlementBackfills,
    trialEntitlementsNeedBackfill: trialNeedsEntitlements,
    assignments: Object.fromEntries(assignments),
    organizationsObserved: tenantCount,
    organizationSubscriptionMutation: false,
    legacyLimitMutation: false,
    planVersionReassignment: false,
  }, null, 2))

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data changed. Re-run with --apply after reviewing the dry-run output.`)
    return
  }

  const planBackup = await backupDocuments({
    collection: plans,
    filter: {},
    migrationName: MIGRATION,
    backupDir: cli.backupDir,
  })
  const platformBackup = await backupDocuments({
    collection: platformSettings,
    filter: { key: 'platform' },
    migrationName: MIGRATION,
    backupDir: cli.backupDir,
  })

  let modifiedPlanVersions = 0
  for (const { row, set } of planChanges) {
    const result = await plans.updateOne({ _id: row._id }, { $set: set })
    modifiedPlanVersions += result.modifiedCount
  }

  let trialSettingsModified = 0
  if (trialNeedsEntitlements && trialEntitlements) {
    const result = await platformSettings.updateOne(
      { key: 'platform' },
      { $set: { 'trial.entitlements': trialEntitlements } },
      { upsert: true },
    )
    trialSettingsModified = result.modifiedCount + (result.upsertedCount || 0)
  }

  const currentPlans = await plans.find(
    { isCurrent: true, isActive: { $ne: false } },
    { projection: { planId: 1, upgradeRank: 1 } },
  ).toArray()
  const currentRankOwners = new Map<number, string>()
  for (const row of currentPlans) {
    const rank = Number(row.upgradeRank)
    if (!Number.isInteger(rank) || rank < 0) throw new Error(`Current plan ${row.planId} is missing a valid upgradeRank after migration`)
    const owner = currentRankOwners.get(rank)
    if (owner && owner !== String(row.planId)) throw new Error(`Upgrade rank ${rank} is shared by current plans ${owner} and ${row.planId}`)
    currentRankOwners.set(rank, String(row.planId))
  }

  await plans.createIndex(
    { upgradeRank: 1 },
    {
      name: 'current_active_upgrade_rank_unique',
      unique: true,
      partialFilterExpression: { isCurrent: true, isActive: true, upgradeRank: { $type: 'number' } },
    },
  )

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    planBackup,
    platformBackup,
    modifiedPlanVersions,
    trialSettingsModified,
    planFamilies: Object.fromEntries(assignments),
    organizationsObserved: tenantCount,
    organizationSubscriptionMutation: false,
    legacyLimitMutation: false,
    planVersionReassignment: false,
    fieldsBackfilledOnly: ['entitlements', 'displayOrder', 'upgradeRank', 'trial.entitlements'],
    skippedPlanEntitlementBackfills,
  })

  console.log(`[${MIGRATION}] completed modifiedPlanVersions=${modifiedPlanVersions} trialSettingsModified=${trialSettingsModified} manifest=${manifest}`)
}

run()
  .catch((error) => {
    console.error(`[${MIGRATION}] failed`, error)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined)
  })
