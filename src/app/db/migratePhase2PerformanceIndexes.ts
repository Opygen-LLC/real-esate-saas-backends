import mongoose from 'mongoose'
import config from '../../config'
import { migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'phase2-performance-indexes-v1'
const CONFIRMATION = 'phase2-performance-indexes'

type Direction = 1 | -1
type IndexSpec = { collection: string; name: string; keys: Record<string, Direction> }

const INDEXES: IndexSpec[] = [
  // Existing Phase 1/3 indexes are listed too so this migration doubles as a
  // deployment-time audit of the complete Phase 2 query contract.
  { collection: 'properties', name: 'property_tenant_created_cursor', keys: { organizationId: 1, createdAt: -1, _id: -1 } },
  { collection: 'properties', name: 'property_tenant_status_created_cursor', keys: { organizationId: 1, status: 1, createdAt: -1, _id: -1 } },
  { collection: 'leads', name: 'lead_tenant_created_cursor', keys: { organizationId: 1, createdAt: -1, _id: -1 } },
  { collection: 'contacts', name: 'contact_tenant_updated_cursor', keys: { organizationId: 1, updatedAt: -1, _id: -1 } },
  { collection: 'contacts', name: 'contact_tenant_normalized_phone', keys: { organizationId: 1, normalizedPhone: 1 } },
  { collection: 'contacts', name: 'contact_tenant_normalized_email', keys: { organizationId: 1, normalizedEmail: 1 } },
  { collection: 'viewings', name: 'viewing_tenant_created_cursor', keys: { organizationId: 1, createdAt: -1, _id: -1 } },
  { collection: 'tasks', name: 'task_tenant_created_cursor', keys: { organizationId: 1, createdAt: -1, _id: -1 } },
  { collection: 'tasks', name: 'task_tenant_dueat_cursor', keys: { organizationId: 1, dueAt: 1, _id: 1 } },
  { collection: 'websitesubmissions', name: 'website_submission_tenant_deleted_submitted_cursor', keys: { organizationId: 1, deletedAt: 1, submittedAt: -1, _id: -1 } },
  { collection: 'websitesubmissions', name: 'website_submission_tenant_email_exact', keys: { organizationId: 1, email: 1 } },
  { collection: 'websitesubmissions', name: 'website_submission_tenant_phone_exact', keys: { organizationId: 1, phone: 1 } },
  { collection: 'activities', name: 'activity_tenant_lead_created_cursor', keys: { organizationId: 1, leadId: 1, createdAt: -1, _id: -1 } },
  { collection: 'activities', name: 'activity_tenant_contact_created_cursor', keys: { organizationId: 1, contactId: 1, createdAt: -1, _id: -1 } },
  { collection: 'notifications', name: 'tenant_user_dismissed_created', keys: { organizationId: 1, userId: 1, dismissedAt: 1, createdAt: -1, _id: -1 } },
  { collection: 'financetransactions', name: 'finance_transaction_tenant_deleted_created_cursor', keys: { organizationId: 1, deletedAt: 1, createdAt: -1, _id: -1 } },
  { collection: 'financetransactions', name: 'finance_transaction_tenant_deleted_date_cursor', keys: { organizationId: 1, deletedAt: 1, transactionDate: -1, _id: -1 } },
  { collection: 'financetransactions', name: 'finance_transaction_tenant_deleted_status_created', keys: { organizationId: 1, deletedAt: 1, status: 1, createdAt: -1, _id: -1 } },
  { collection: 'financetransactions', name: 'finance_transaction_tenant_deleted_amount_sort', keys: { organizationId: 1, deletedAt: 1, amount: -1, _id: -1 } },
  { collection: 'financetransactions', name: 'finance_transaction_tenant_deleted_updated_sort', keys: { organizationId: 1, deletedAt: 1, updatedAt: -1, _id: -1 } },
  { collection: 'financetransactions', name: 'finance_transaction_tenant_deleted_category_sort', keys: { organizationId: 1, deletedAt: 1, category: 1, _id: 1 } },
  { collection: 'financetransactions', name: 'finance_transaction_tenant_deleted_status_sort', keys: { organizationId: 1, deletedAt: 1, status: 1, _id: 1 } },
  { collection: 'financetransactions', name: 'finance_transaction_tenant_deleted_payment_sort', keys: { organizationId: 1, deletedAt: 1, paymentMethod: 1, _id: 1 } },
  { collection: 'financeinvoices', name: 'finance_invoice_tenant_archived_created_cursor', keys: { organizationId: 1, archivedAt: 1, createdAt: -1, _id: -1 } },
]
const keySignature = (key: Record<string, unknown>) => JSON.stringify(Object.entries(key))

const run = async () => {
  const cli = migrationCli()
  requireConfirmation(cli, CONFIRMATION)
  await mongoose.connect(process.env.PHASE2_DATABASE_URL || config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const report: Array<IndexSpec & { state: 'present' | 'missing' | 'created' }> = []
  for (const spec of INDEXES) {
    const collection = db.collection(spec.collection)
    const indexes = await collection.listIndexes().toArray().catch((error: any) => {
      if (error?.codeName === 'NamespaceNotFound') return []
      throw error
    })
    const byKey = indexes.find((index: any) => keySignature(index.key || {}) === keySignature(spec.keys))
    if (byKey) {
      report.push({ ...spec, state: 'present' })
      continue
    }
    const sameName = indexes.find((index: any) => index.name === spec.name)
    if (sameName) throw new Error(`Index ${spec.collection}.${spec.name} exists with a different key; inspect manually before applying`)
    if (!cli.apply) {
      report.push({ ...spec, state: 'missing' })
      continue
    }
    await collection.createIndex(spec.keys, { name: spec.name, background: true })
    report.push({ ...spec, state: 'created' })
  }

  const counts = report.reduce<Record<string, number>>((acc, item) => {
    acc[item.state] = (acc[item.state] || 0) + 1
    return acc
  }, {})
  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, { mode: cli.apply ? 'apply' : 'dry-run', counts, indexes: report })
  console.table(report.map(({ collection, name, state }) => ({ collection, name, state })))
  console.log(`[${MIGRATION}] manifest=${manifest}${cli.apply ? '' : `; no indexes changed. Re-run with --apply --confirm=${CONFIRMATION} after review.`}`)
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
