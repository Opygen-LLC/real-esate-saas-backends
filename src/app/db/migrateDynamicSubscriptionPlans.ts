import mongoose from 'mongoose'
import config from '../../config'
import { backupDocuments, migrationCli, writeMigrationManifest } from './migrations/migrationSafety'
import { legacyPlanOrder } from '../module/subscriptionPlan/planIdentity'

const MIGRATION = 'dynamic-subscription-plans-v1'

const isValidOrder = (value: unknown) => Number.isInteger(Number(value)) && Number(value) >= 0

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const plans = db.collection('subscriptionplans')
  const rows = await plans.find({}, {
    projection: { planId: 1, version: 1, priceMonthly: 1, isCurrent: 1, displayOrder: 1, upgradeRank: 1 },
  }).sort({ planId: 1, version: -1 }).toArray()

  const families = new Map<string, typeof rows>()
  for (const row of rows) {
    const planId = String(row.planId || '').trim().toLowerCase()
    if (!planId || planId === 'trial') continue
    const family = families.get(planId) || []
    family.push(row)
    families.set(planId, family)
  }

  const assignments = new Map<string, { displayOrder: number; upgradeRank: number }>()
  const usedRanks = new Set<number>()

  for (const [planId, family] of families) {
    const existingRank = family.find((row) => isValidOrder(row.upgradeRank))?.upgradeRank
    const existingDisplay = family.find((row) => isValidOrder(row.displayOrder))?.displayOrder
    const legacy = legacyPlanOrder(planId)
    if (isValidOrder(existingRank) || legacy !== null) {
      const upgradeRank = isValidOrder(existingRank) ? Number(existingRank) : Number(legacy)
      const displayOrder = isValidOrder(existingDisplay) ? Number(existingDisplay) : Number(legacy ?? upgradeRank)
      assignments.set(planId, { displayOrder, upgradeRank })
      usedRanks.add(upgradeRank)
    }
  }

  const assignedRankOwners = new Map<number, string>()
  for (const [planId, assignment] of assignments) {
    const owner = assignedRankOwners.get(assignment.upgradeRank)
    if (owner && owner !== planId) {
      throw new Error(`Upgrade rank ${assignment.upgradeRank} is already assigned to both ${owner} and ${planId}. Resolve the conflict before applying this migration.`)
    }
    assignedRankOwners.set(assignment.upgradeRank, planId)
  }

  let nextRank = Math.max(0, ...Array.from(usedRanks.values())) + 10
  const unassigned = Array.from(families.entries())
    .filter(([planId]) => !assignments.has(planId))
    .sort(([, a], [, b]) => {
      const aCurrent = a.find((row) => row.isCurrent) || a[0]
      const bCurrent = b.find((row) => row.isCurrent) || b[0]
      return Number(aCurrent?.priceMonthly || 0) - Number(bCurrent?.priceMonthly || 0)
        || String(aCurrent?.planId || '').localeCompare(String(bCurrent?.planId || ''))
    })

  for (const [planId] of unassigned) {
    while (usedRanks.has(nextRank)) nextRank += 10
    assignments.set(planId, { displayOrder: nextRank, upgradeRank: nextRank })
    usedRanks.add(nextRank)
    nextRank += 10
  }

  const missingFilter = {
    $or: [
      { displayOrder: { $exists: false } },
      { displayOrder: null },
      { upgradeRank: { $exists: false } },
      { upgradeRank: null },
    ],
  }
  const missingCount = await plans.countDocuments(missingFilter)

  console.log(JSON.stringify({
    migration: MIGRATION,
    mode: cli.apply ? 'APPLY' : 'DRY-RUN',
    planVersions: rows.length,
    planFamilies: families.size,
    missingPlanVersions: missingCount,
    assignments: Object.fromEntries(assignments),
    tenantPlanVersionMutation: false,
    indexes: ['subscriptionplans.current_active_upgrade_rank_unique'],
  }, null, 2))

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data changed. Re-run with --apply after reviewing the dry-run output.`)
    return
  }

  const backup = await backupDocuments({
    collection: plans,
    filter: missingFilter,
    migrationName: MIGRATION,
    backupDir: cli.backupDir,
  })

  let modifiedCount = 0
  for (const [planId, assignment] of assignments) {
    const result = await plans.updateMany(
      {
        planId,
        $or: [
          { displayOrder: { $exists: false } },
          { displayOrder: null },
          { upgradeRank: { $exists: false } },
          { upgradeRank: null },
        ],
      },
      [
        {
          $set: {
            displayOrder: { $ifNull: ['$displayOrder', assignment.displayOrder] },
            upgradeRank: { $ifNull: ['$upgradeRank', assignment.upgradeRank] },
          },
        },
      ],
    )
    modifiedCount += result.modifiedCount
  }

  const current = await plans.find({ isCurrent: true, isActive: { $ne: false } }, { projection: { planId: 1, upgradeRank: 1 } }).toArray()
  const rankOwners = new Map<number, string>()
  for (const row of current) {
    const rank = Number(row.upgradeRank)
    if (!Number.isInteger(rank)) throw new Error(`Current plan ${row.planId} is missing a valid upgradeRank after migration`)
    const owner = rankOwners.get(rank)
    if (owner && owner !== String(row.planId)) throw new Error(`Upgrade rank ${rank} is shared by ${owner} and ${row.planId}`)
    rankOwners.set(rank, String(row.planId))
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
    backup,
    modifiedPlanVersions: modifiedCount,
    planFamilies: Object.fromEntries(assignments),
    tenantPlanVersionMutation: false,
    appliedIndexes: ['subscriptionplans.current_active_upgrade_rank_unique'],
  })
  console.log(`[${MIGRATION}] completed modified=${modifiedCount} manifest=${manifest}`)
}

run()
  .catch((error) => {
    console.error(`[${MIGRATION}] failed`, error)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined)
  })
