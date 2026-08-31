import mongoose from 'mongoose'
import config from '../../config'
import { migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'phase1-query-indexes-v1'
const CONFIRMATION = 'phase1-query-indexes'
type Direction = 1 | -1
type DesiredIndex = { collection: string; key: Record<string, Direction>; name: string }

const desiredIndexes: DesiredIndex[] = [
  { collection: 'properties', key: { organizationId: 1, createdAt: -1 }, name: 'phase1_property_tenant_created_desc' },
  { collection: 'properties', key: { organizationId: 1, status: 1, price: 1 }, name: 'phase1_property_tenant_status_price' },
  { collection: 'leads', key: { organizationId: 1, createdAt: -1 }, name: 'phase1_lead_tenant_created_desc' },
  { collection: 'leads', key: { organizationId: 1, leadStatus: 1, isConverted: 1, createdAt: -1 }, name: 'phase1_lead_tenant_status_converted_created' },
  { collection: 'tasks', key: { organizationId: 1, dueAt: 1, status: 1 }, name: 'phase1_task_tenant_due_status' },
  { collection: 'tasks', key: { organizationId: 1, linkedProperty: 1, dueAt: 1 }, name: 'phase1_task_tenant_property_due' },
  { collection: 'viewings', key: { organizationId: 1, date: 1, status: 1, agentId: 1, startTime: 1, endTime: 1 }, name: 'viewing_tenant_date_status_agent_window' },
  { collection: 'viewings', key: { organizationId: 1, date: 1, status: 1, propertyId: 1, startTime: 1, endTime: 1 }, name: 'viewing_tenant_date_status_property_window' },
  { collection: 'websitesubmissions', key: { organizationId: 1, submittedAt: -1 }, name: 'phase1_submission_tenant_submitted_desc' },
  { collection: 'websitesubmissions', key: { organizationId: 1, status: 1, submittedAt: -1 }, name: 'phase1_submission_tenant_status_submitted_desc' },
  { collection: 'users', key: { organizationId: 1, userRole: 1, status: 1 }, name: 'user_tenant_role_status' },
  { collection: 'users', key: { organizationId: 1, createdAt: -1 }, name: 'user_tenant_created_desc' },
  { collection: 'financetransactions', key: { organizationId: 1, transactionDate: -1, type: 1, status: 1 }, name: 'phase1_finance_tx_tenant_date_type_status' },
  { collection: 'financetransactions', key: { organizationId: 1, deletedAt: 1, createdAt: -1 }, name: 'phase1_finance_tx_tenant_deleted_created' },
  { collection: 'financeinvoices', key: { organizationId: 1, status: 1, dueDate: 1 }, name: 'phase1_invoice_tenant_status_due' },
  { collection: 'financeinvoices', key: { organizationId: 1, archivedAt: 1, createdAt: -1 }, name: 'phase1_invoice_tenant_archived_created' },
  { collection: 'financecommissions', key: { organizationId: 1, agentId: 1, createdAt: -1 }, name: 'phase1_commission_tenant_agent_created' },
  { collection: 'financecommissions', key: { organizationId: 1, archivedAt: 1, createdAt: -1 }, name: 'phase1_commission_tenant_archived_created' },
  { collection: 'domainrecords', key: { lifecycleStatus: 1, nextCheckAt: 1 }, name: 'phase1_domain_lifecycle_next_check' },
  { collection: 'domainrecords', key: { status: 1, nextCheckAt: 1 }, name: 'phase1_domain_status_next_check' },
]

const keySignature = (key: Record<string, unknown>) => JSON.stringify(Object.entries(key))

const run = async () => {
  const cli = migrationCli()
  requireConfirmation(cli, CONFIRMATION)
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const report: Array<{ collection: string; name: string; key: Record<string, Direction>; state: 'present' | 'missing' | 'created' }> = []
  for (const desired of desiredIndexes) {
    const collection = db.collection(desired.collection)
    const indexes = await collection.listIndexes().toArray().catch((error: unknown) => {
      const codeName = (error as { codeName?: string }).codeName
      if (codeName === 'NamespaceNotFound') return []
      throw error
    })
    const signature = keySignature(desired.key)
    const byKey = indexes.find((index: { key?: Record<string, unknown> }) => keySignature(index.key || {}) === signature)
    if (byKey) {
      report.push({ ...desired, state: 'present' })
      continue
    }
    const sameName = indexes.find((index: { name?: string }) => index.name === desired.name)
    if (sameName) throw new Error(`Index ${desired.collection}.${desired.name} exists with a different key; inspect it manually before continuing`)
    if (!cli.apply) {
      report.push({ ...desired, state: 'missing' })
      continue
    }
    await collection.createIndex(desired.key, { name: desired.name })
    report.push({ ...desired, state: 'created' })
  }

  const counts = report.reduce<Record<string, number>>((acc, item) => {
    acc[item.state] = (acc[item.state] || 0) + 1
    return acc
  }, {})
  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, { mode: cli.apply ? 'apply' : 'dry-run', counts, indexes: report })
  console.table(counts)
  console.log(`[${MIGRATION}] manifest=${manifest}${cli.apply ? '' : `; no indexes changed. Re-run with --apply --confirm=${CONFIRMATION} after review.`}`)
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
