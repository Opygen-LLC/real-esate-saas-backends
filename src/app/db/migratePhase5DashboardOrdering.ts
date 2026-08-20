import mongoose from 'mongoose'
import config from '../../config'
import { migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'phase5-dashboard-ordering'

type IndexPlan = readonly [string, Record<string, 1 | -1>, { name: string }]

const INDEXES: IndexPlan[] = [
  ['properties', { organizationId: 1, createdAt: -1, _id: -1 }, { name: 'phase5_tenant_created_stable' }],
  ['leads', { organizationId: 1, isConverted: 1, createdAt: -1, _id: -1 }, { name: 'phase5_tenant_converted_created_stable' }],
  ['tasks', { organizationId: 1, createdAt: -1, _id: -1 }, { name: 'phase5_tenant_created_stable' }],
  ['viewings', { organizationId: 1, createdAt: -1, _id: -1 }, { name: 'phase5_tenant_created_stable' }],
  ['viewings', { organizationId: 1, date: 1, startTime: 1, _id: 1 }, { name: 'phase5_tenant_calendar_stable' }],
  ['users', { organizationId: 1, createdAt: -1, _id: -1 }, { name: 'phase5_tenant_created_stable' }],
  ['websitesubmissions', { organizationId: 1, createdAt: -1, _id: -1 }, { name: 'phase5_tenant_created_stable' }],
  ['agencyreviews', { organizationId: 1, createdAt: -1, _id: -1 }, { name: 'phase5_tenant_created_stable' }],
  ['reviewinvitations', { organizationId: 1, createdAt: -1, _id: -1 }, { name: 'phase5_tenant_created_stable' }],
  ['financetransactions', { organizationId: 1, createdAt: -1, _id: -1 }, { name: 'phase5_tenant_created_stable' }],
  ['financeinvoices', { organizationId: 1, archivedAt: 1, createdAt: -1, _id: -1 }, { name: 'phase5_tenant_active_created_stable' }],
  ['financecommissions', { organizationId: 1, createdAt: -1, _id: -1 }, { name: 'phase5_tenant_created_stable' }],
  ['financevendors', { organizationId: 1, createdAt: -1, _id: -1 }, { name: 'phase5_tenant_created_stable' }],
  ['financebudgets', { organizationId: 1, createdAt: -1, _id: -1 }, { name: 'phase5_tenant_created_stable' }],
  ['subscriptionpayments', { organizationId: 1, createdAt: -1, _id: -1 }, { name: 'phase5_tenant_created_stable' }],
  ['subscriptionpayments', { createdAt: -1, _id: -1 }, { name: 'phase5_created_stable' }],
  ['auditevents', { organizationId: 1, createdAt: -1, _id: -1 }, { name: 'phase5_tenant_created_stable' }],
  ['auditevents', { createdAt: -1, _id: -1 }, { name: 'phase5_created_stable' }],
  ['organizations', { createdAt: -1, _id: -1 }, { name: 'phase5_created_stable' }],
  ['bkashpayments', { createdAt: -1, _id: -1 }, { name: 'phase5_created_stable' }],
]

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, { autoIndex: false, serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} indexes=${INDEXES.length}`)
  if (!cli.apply) {
    for (const [collectionName, keys, options] of INDEXES) console.log(`[${MIGRATION}] plan ${collectionName}.${options.name} ${JSON.stringify(keys)}`)
    console.log(`[${MIGRATION}] No indexes changed. Use --apply after reviewing this plan.`)
    return
  }

  const applied: string[] = []
  for (const [collectionName, keys, options] of INDEXES) {
    await db.collection(collectionName).createIndex(keys, options)
    applied.push(`${collectionName}.${options.name}`)
  }

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, { appliedIndexes: applied })
  console.log(`[${MIGRATION}] completed manifest=${manifest}`)
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
