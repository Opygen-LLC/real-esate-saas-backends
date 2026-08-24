import mongoose, { ClientSession } from 'mongoose'
import config from '../../config'
import { Cache } from '../../shared/cache'
import { mongoSupportsTransactions } from './mongoCapabilities'
import { backupDocuments, migrationCli, writeMigrationManifest } from './migrations/migrationSafety'
import type { PlanStatus } from '../module/subscriptionPlan/planLifecycle'

const MIGRATION = 'subscription-plan-lifecycle-v2'

const asDate = (value: unknown): Date | null => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

const versionNumber = (row: Record<string, any>) => Number.isFinite(Number(row.version)) ? Number(row.version) : 0
const effectiveTime = (row: Record<string, any>) => asDate(row.effectiveFrom)?.getTime() ?? 0

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
  const now = new Date()
  const families = new Map<string, Record<string, any>[]>()
  for (const row of rows) {
    const planId = String(row.planId || '')
    if (!planId) throw new Error(`Plan document ${String(row._id)} is missing planId`)
    families.set(planId, [...(families.get(planId) || []), row])
  }

  const changes: Array<{ row: Record<string, any>; set: Record<string, unknown> }> = []
  const summary = { current: 0, scheduled: 0, grandfathered: 0, retired: 0 }
  const familyCurrent: Record<string, string | null> = {}

  for (const [planId, family] of families) {
    const active = family.filter((row) => row.isActive !== false)
    const effectiveNow = active.filter((row) => {
      const from = asDate(row.effectiveFrom)
      const to = asDate(row.effectiveTo)
      return (!from || from.getTime() <= now.getTime()) && (!to || to.getTime() > now.getTime())
    })
    const current = [...effectiveNow].sort((a, b) => effectiveTime(b) - effectiveTime(a) || versionNumber(b) - versionNumber(a))[0] || null
    familyCurrent[planId] = current ? `${planId}@v${versionNumber(current)}` : null

    for (const row of family) {
      const from = asDate(row.effectiveFrom)
      let status: PlanStatus
      if (row.isActive === false) status = 'retired'
      else if (from && from.getTime() > now.getTime()) status = 'scheduled'
      else if (current && String(row._id) === String(current._id)) status = 'current'
      else status = 'grandfathered'

      summary[status] += 1
      const set: Record<string, unknown> = {
        status,
        isCurrent: status === 'current',
        isActive: status !== 'retired',
        // Phase 2 makes grandfathering the only automatic policy. No tenant assignment is mutated here.
        grandfatherExisting: true,
      }
      if (status === 'current' || status === 'grandfathered') set.migrationAppliedAt = row.migrationAppliedAt || now
      if (status === 'scheduled') set.migrationAppliedAt = null
      if (status === 'retired' && !row.effectiveTo) set.effectiveTo = now
      changes.push({ row, set })
    }
  }

  console.log(JSON.stringify({
    migration: MIGRATION,
    mode: cli.apply ? 'APPLY' : 'DRY-RUN',
    planVersions: rows.length,
    families: families.size,
    lifecycleSummary: summary,
    familyCurrent,
    tenantAssignmentMutation: false,
    commercialPriceMutation: false,
    planIdMutation: false,
    pendingAutomaticTenantMigrationsDisabled: true,
  }, null, 2))

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No data changed. Re-run with --apply after reviewing the lifecycle summary.`)
    return
  }

  const planBackup = await backupDocuments({
    collection: plans,
    filter: {},
    migrationName: MIGRATION,
    backupDir: cli.backupDir,
  })

  const transactional = await mongoSupportsTransactions()
  const applyChanges = async (session?: ClientSession) => {
    // Clear legacy current flags first so a future version that used to be isCurrent=true
    // cannot conflict when the actually-effective version becomes current.
    await plans.updateMany({}, { $set: { isCurrent: false } }, session ? { session } : undefined)
    for (const { row, set } of changes) {
      await plans.updateOne({ _id: row._id }, { $set: set }, session ? { session } : undefined)
    }
  }

  if (transactional) {
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => applyChanges(session))
    } finally {
      await session.endSession()
    }
  } else {
    if (config.env === 'production') throw new Error('Phase 2 lifecycle migration requires a MongoDB replica set or mongos in production')
    await applyChanges()
  }

  await plans.createIndex(
    { planId: 1, status: 1 },
    { name: 'planId_1_status_1_current_unique', unique: true, partialFilterExpression: { status: 'current' } },
  )
  await plans.createIndex({ status: 1, tierRank: 1 }, { name: 'status_1_tierRank_1' })
  await Cache.plans.del('catalog')

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    planBackup,
    modifiedPlanVersions: changes.length,
    lifecycleSummary: summary,
    familyCurrent,
    tenantAssignmentMutation: false,
    commercialPriceMutation: false,
    planIdMutation: false,
    legacyMirrorsRetained: ['isActive', 'isCurrent', 'grandfatherExisting', 'effectiveFrom', 'effectiveTo', 'migrationAppliedAt'],
  })
  console.log(`[${MIGRATION}] completed modifiedPlanVersions=${changes.length} manifest=${manifest}`)
}

run()
  .catch((error) => {
    console.error(`[${MIGRATION}] failed`, error)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined)
  })
