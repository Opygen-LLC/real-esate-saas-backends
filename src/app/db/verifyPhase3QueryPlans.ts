import mongoose, { Types } from 'mongoose'
import config from '../../config'
import { safeRegexPattern } from '../helpers/searchQuery'

const MAX_TIME_MS = Number(process.env.PHASE3_EXPLAIN_MAX_TIME_MS || 5_000)
const LIMIT = Math.max(1, Math.min(50, Number(process.env.PHASE3_EXPLAIN_LIMIT || 20)))

type ExplainCase = {
  name: string
  collection: string
  filter: Record<string, unknown>
  sort?: Record<string, 1 | -1>
  requireNoBlockingSort?: boolean
}

const walkStages = (node: unknown, stages = new Set<string>()): Set<string> => {
  if (!node || typeof node !== 'object') return stages
  if (Array.isArray(node)) {
    for (const child of node) walkStages(child, stages)
    return stages
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (['stage', 'queryPlanner'].includes(key) && typeof value === 'string') stages.add(value)
    walkStages(value, stages)
  }
  return stages
}

const winningIndexes = (node: unknown, names = new Set<string>()): Set<string> => {
  if (!node || typeof node !== 'object') return names
  if (Array.isArray(node)) {
    for (const child of node) winningIndexes(child, names)
    return names
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'indexName' && typeof value === 'string') names.add(value)
    winningIndexes(value, names)
  }
  return names
}

const run = async () => {
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const organizations = db.collection('organizations')
  const selected = process.env.PHASE3_ORGANIZATION_ID
    ? await organizations.findOne({ organizationId: process.env.PHASE3_ORGANIZATION_ID }, { projection: { organizationId: 1, sub_domain: 1 } })
    : await organizations.findOne({}, { projection: { organizationId: 1, sub_domain: 1 } })
  if (!selected?.organizationId) throw new Error('No organization is available for query-plan verification')
  const organizationId = String(selected.organizationId)

  const [property, task, lead, viewing] = await Promise.all([
    db.collection('properties').findOne({ organizationId }, { projection: { _id: 1, title: 1, agentId: 1 } }),
    db.collection('tasks').findOne({ organizationId }, { projection: { _id: 1, title: 1 } }),
    db.collection('leads').findOne({ organizationId }, { projection: { _id: 1, name: 1, assignedAgent: 1 } }),
    db.collection('viewings').findOne({ organizationId }, { projection: { _id: 1, agentId: 1, propertyId: 1, date: 1, startTime: 1, endTime: 1 } }),
  ])

  const fallbackObjectId = new Types.ObjectId()
  const agentId = viewing?.agentId || lead?.assignedAgent || property?.agentId || fallbackObjectId
  const propertyId = viewing?.propertyId || property?._id || fallbackObjectId
  const date = String(viewing?.date || '2099-01-01')
  const search = safeRegexPattern(process.env.PHASE3_SEARCH_SAMPLE || property?.title || task?.title || lead?.name || 'phase3')

  const cases: ExplainCase[] = [
    { name: 'property-list-created', collection: 'properties', filter: { organizationId }, sort: { createdAt: -1, _id: -1 }, requireNoBlockingSort: true },
    { name: 'property-search', collection: 'properties', filter: { organizationId, $or: [{ title: { $regex: search, $options: 'i' } }, { city: { $regex: search, $options: 'i' } }] }, sort: { createdAt: -1, _id: -1 } },
    { name: 'task-list-due', collection: 'tasks', filter: { organizationId }, sort: { dueAt: 1, _id: 1 }, requireNoBlockingSort: true },
    { name: 'lead-list-created', collection: 'leads', filter: { organizationId, isConverted: { $ne: true }, isLocked: { $ne: true } }, sort: { createdAt: -1, _id: -1 }, requireNoBlockingSort: true },
    { name: 'viewing-agent-conflict', collection: 'viewings', filter: { organizationId, date, status: { $in: ['Scheduled', 'Confirmed'] }, agentId, startTime: { $lt: '23:59' }, endTime: { $gt: '00:00' } } },
    { name: 'viewing-property-conflict', collection: 'viewings', filter: { organizationId, date, status: { $in: ['Scheduled', 'Confirmed'] }, propertyId, startTime: { $lt: '23:59' }, endTime: { $gt: '00:00' } } },
    { name: 'public-site-subdomain', collection: 'organizations', filter: { sub_domain: String(selected.sub_domain || '__phase3_missing__') } },
    { name: 'public-site-organization', collection: 'organizations', filter: { organizationId } },
  ]

  const failures: string[] = []
  for (const item of cases) {
    let cursor = db.collection(item.collection).find(item.filter).limit(LIMIT).maxTimeMS(MAX_TIME_MS)
    if (item.sort) cursor = cursor.sort(item.sort)
    const explain = await cursor.explain('executionStats')
    const plan = explain.queryPlanner?.winningPlan || explain.queryPlanner
    const stages = walkStages(plan)
    const indexes = [...winningIndexes(plan)]
    const collscan = stages.has('COLLSCAN')
    const blockingSort = stages.has('SORT')
    const stats = explain.executionStats || {}
    console.log(JSON.stringify({
      case: item.name,
      collection: item.collection,
      indexes,
      stages: [...stages],
      totalKeysExamined: stats.totalKeysExamined,
      totalDocsExamined: stats.totalDocsExamined,
      nReturned: stats.nReturned,
      executionTimeMillis: stats.executionTimeMillis,
    }))
    if (collscan) failures.push(`${item.name}: COLLSCAN`)
    if (item.requireNoBlockingSort && blockingSort) failures.push(`${item.name}: blocking SORT`)
  }

  if (failures.length) {
    throw new Error(`Phase 3 query-plan verification failed: ${failures.join('; ')}`)
  }
  console.log(`[phase3-query-plans] PASS organization=${organizationId} cases=${cases.length}`)
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
