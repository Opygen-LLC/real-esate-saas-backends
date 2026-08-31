import mongoose, { Types } from 'mongoose'
import config from '../../config'

const MAX_TIME_MS = Math.max(500, Number(process.env.PHASE2_EXPLAIN_MAX_TIME_MS || 5_000))
const LIMIT = Math.max(1, Math.min(50, Number(process.env.PHASE2_EXPLAIN_LIMIT || 20)))
const EXAMINED_MULTIPLIER = Math.max(5, Number(process.env.PHASE2_EXAMINED_MULTIPLIER || 50))
const EXAMINED_FLOOR = Math.max(100, Number(process.env.PHASE2_EXAMINED_FLOOR || 1_000))

type ExplainCase = {
  name: string
  collection: string
  filter: Record<string, unknown>
  sort: Record<string, 1 | -1>
  requireNoBlockingSort?: boolean
  allowEmpty?: boolean
}

const walkPlan = (node: unknown, stages = new Set<string>(), indexes = new Set<string>()): { stages: Set<string>; indexes: Set<string> } => {
  if (!node || typeof node !== 'object') return { stages, indexes }
  if (Array.isArray(node)) {
    for (const child of node) walkPlan(child, stages, indexes)
    return { stages, indexes }
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'stage' && typeof value === 'string') stages.add(value)
    if (key === 'indexName' && typeof value === 'string') indexes.add(value)
    walkPlan(value, stages, indexes)
  }
  return { stages, indexes }
}

const run = async () => {
  await mongoose.connect(process.env.PHASE2_DATABASE_URL || config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const selected = process.env.PHASE2_ORGANIZATION_ID
    ? await db.collection('organizations').findOne({ organizationId: process.env.PHASE2_ORGANIZATION_ID }, { projection: { organizationId: 1 } })
    : await db.collection('organizations').findOne({}, { projection: { organizationId: 1 } })
  if (!selected?.organizationId) throw new Error('No organization is available for Phase 2 query-plan verification')
  const organizationId = String(selected.organizationId)

  const [notification, activity] = await Promise.all([
    db.collection('notifications').findOne({ organizationId }, { projection: { userId: 1 } }),
    db.collection('activities').findOne({ organizationId, leadId: { $type: 'objectId' } }, { projection: { leadId: 1 } }),
  ])
  const fallbackId = new Types.ObjectId()
  const notificationUserId = notification?.userId || fallbackId
  const activityLeadId = activity?.leadId || fallbackId

  const cases: ExplainCase[] = [
    { name: 'properties-list', collection: 'properties', filter: { organizationId }, sort: { createdAt: -1, _id: -1 }, requireNoBlockingSort: true },
    { name: 'leads-list', collection: 'leads', filter: { organizationId, isConverted: { $ne: true }, isLocked: { $ne: true } }, sort: { createdAt: -1, _id: -1 }, requireNoBlockingSort: true },
    { name: 'contacts-list', collection: 'contacts', filter: { organizationId, relationshipState: { $ne: 'legacy_preconversion' } }, sort: { updatedAt: -1, _id: -1 }, requireNoBlockingSort: true },
    { name: 'lead-search-email-exact', collection: 'leads', filter: { organizationId, normalizedEmail: '__phase2_no_match__' }, sort: { _id: 1 }, allowEmpty: true },
    { name: 'contact-search-email-exact', collection: 'contacts', filter: { organizationId, normalizedEmail: '__phase2_no_match__' }, sort: { _id: 1 }, allowEmpty: true },
    { name: 'website-submission-search-email-exact', collection: 'websitesubmissions', filter: { organizationId, email: '__phase2_no_match__' }, sort: { _id: 1 }, allowEmpty: true },
    { name: 'viewings-list', collection: 'viewings', filter: { organizationId }, sort: { createdAt: -1, _id: -1 }, requireNoBlockingSort: true },
    { name: 'tasks-list', collection: 'tasks', filter: { organizationId }, sort: { createdAt: -1, _id: -1 }, requireNoBlockingSort: true },
    { name: 'website-submissions-list', collection: 'websitesubmissions', filter: { organizationId, deletedAt: null }, sort: { submittedAt: -1, _id: -1 }, requireNoBlockingSort: true },
    { name: 'finance-transactions-list', collection: 'financetransactions', filter: { organizationId, deletedAt: null }, sort: { createdAt: -1, _id: -1 }, requireNoBlockingSort: true },
    { name: 'finance-transactions-by-date', collection: 'financetransactions', filter: { organizationId, deletedAt: null }, sort: { transactionDate: -1, _id: -1 }, requireNoBlockingSort: true },
    { name: 'finance-transactions-by-amount', collection: 'financetransactions', filter: { organizationId, deletedAt: null }, sort: { amount: -1, _id: -1 }, requireNoBlockingSort: true },
    { name: 'finance-transactions-by-updated', collection: 'financetransactions', filter: { organizationId, deletedAt: null }, sort: { updatedAt: -1, _id: -1 }, requireNoBlockingSort: true },
    { name: 'finance-transactions-by-category', collection: 'financetransactions', filter: { organizationId, deletedAt: null }, sort: { category: 1, _id: 1 }, requireNoBlockingSort: true },
    { name: 'finance-transactions-by-status', collection: 'financetransactions', filter: { organizationId, deletedAt: null }, sort: { status: 1, _id: 1 }, requireNoBlockingSort: true },
    { name: 'finance-transactions-by-payment', collection: 'financetransactions', filter: { organizationId, deletedAt: null }, sort: { paymentMethod: 1, _id: 1 }, requireNoBlockingSort: true },
    { name: 'finance-invoices-list', collection: 'financeinvoices', filter: { organizationId, archivedAt: null }, sort: { createdAt: -1, _id: -1 }, requireNoBlockingSort: true },
    { name: 'notifications-list', collection: 'notifications', filter: { organizationId, userId: notificationUserId, dismissedAt: null }, sort: { createdAt: -1, _id: -1 }, requireNoBlockingSort: true, allowEmpty: true },
    { name: 'activities-by-lead', collection: 'activities', filter: { organizationId, leadId: activityLeadId }, sort: { createdAt: -1, _id: -1 }, requireNoBlockingSort: true, allowEmpty: true },
  ]

  const failures: string[] = []
  for (const item of cases) {
    const explain = await db.collection(item.collection)
      .find(item.filter)
      .sort(item.sort)
      .limit(LIMIT)
      .maxTimeMS(MAX_TIME_MS)
      .explain('executionStats')
    const plan = explain.queryPlanner?.winningPlan || explain.queryPlanner
    const walked = walkPlan(plan)
    const stats = explain.executionStats || {}
    const nReturned = Number(stats.nReturned || 0)
    const docsExamined = Number(stats.totalDocsExamined || 0)
    const keysExamined = Number(stats.totalKeysExamined || 0)
    const collscan = walked.stages.has('COLLSCAN')
    const blockingSort = walked.stages.has('SORT')
    const examinedLimit = Math.max(EXAMINED_FLOOR, Math.max(1, nReturned) * EXAMINED_MULTIPLIER)

    console.log(JSON.stringify({
      case: item.name,
      collection: item.collection,
      indexes: [...walked.indexes],
      stages: [...walked.stages],
      totalKeysExamined: keysExamined,
      totalDocsExamined: docsExamined,
      nReturned,
      executionTimeMillis: stats.executionTimeMillis,
      examinedLimit,
    }))

    if (collscan) failures.push(`${item.name}: COLLSCAN`)
    if (item.requireNoBlockingSort && blockingSort) failures.push(`${item.name}: blocking SORT`)
    if ((nReturned > 0 || !item.allowEmpty) && docsExamined > examinedLimit) failures.push(`${item.name}: examined ${docsExamined} docs for ${nReturned} rows`)
  }

  if (failures.length) throw new Error(`Phase 2 query-plan verification failed: ${failures.join('; ')}`)
  console.log(`[phase2-query-plans] PASS organization=${organizationId} cases=${cases.length}`)
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
