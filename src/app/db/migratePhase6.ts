import mongoose from 'mongoose'
import config from '../../config'

const run = async () => {
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const specs: Array<[string, Record<string, 1 | -1>, Record<string, unknown>]> = [
    ['leads', { organizationId: 1, createdAt: -1 }, { name: 'phase6_tenant_created' }],
    ['leads', { organizationId: 1, assignedAgent: 1, createdAt: -1 }, { name: 'phase6_tenant_assignee_created' }],
    ['leads', { organizationId: 1, leadStatus: 1, updatedAt: -1 }, { name: 'phase6_tenant_status_updated' }],
    ['properties', { organizationId: 1, createdAt: -1 }, { name: 'phase6_tenant_created' }],
    ['properties', { organizationId: 1, agentId: 1, status: 1 }, { name: 'phase6_tenant_agent_status' }],
    ['properties', { organizationId: 1, views: -1, updatedAt: -1 }, { name: 'phase6_tenant_views_updated' }],
    ['viewings', { organizationId: 1, status: 1, date: 1 }, { name: 'phase6_tenant_status_date' }],
    ['viewings', { organizationId: 1, agentId: 1, createdAt: -1 }, { name: 'phase6_tenant_agent_created' }],
    ['users', { organizationId: 1, userRole: 1, status: 1 }, { name: 'phase6_tenant_role_status' }],
    ['domainevents', { organizationId: 1, occurredAt: -1 }, { name: 'phase6_tenant_event_time' }],
    ['domainevents', { organizationId: 1, aggregateType: 1, aggregateId: 1, occurredAt: -1 }, { name: 'phase6_tenant_aggregate_time' }],
    ['websitepages', { organizationId: 1, status: 1, updatedAt: -1 }, { name: 'phase6_tenant_page_status' }],
    ['operationsjobs', { status: 1, runAt: 1 }, { name: 'phase6_queue_due' }],
    ['operationsjobs', { organizationId: 1, type: 1, entityId: 1, status: 1 }, { name: 'phase6_queue_entity_status' }],
    ['billings', { status: 1, createdAt: -1 }, { name: 'phase6_billing_status_created' }],
    ['billings', { organizationId: 1, status: 1, createdAt: -1 }, { name: 'phase6_billing_tenant_status_created' }],
    ['organizations', { organizationId: 1, updatedAt: -1 }, { name: 'phase6_org_activity' }],
  ]

  for (const [collectionName, keys, options] of specs) {
    const names = await db.listCollections({ name: collectionName }).toArray()
    if (!names.length) continue
    const collection = db.collection(collectionName)
    let existing = await collection.indexes()
    const intendedName = typeof options.name === 'string' ? options.name : ''
    const conflictingName = intendedName ? existing.find((index: any) => index.name === intendedName && JSON.stringify(index.key) !== JSON.stringify(keys)) : undefined
    if (conflictingName) {
      await collection.dropIndex(conflictingName.name)
      existing = await collection.indexes()
    }
    const sameKeys = existing.some((index: any) => JSON.stringify(index.key) === JSON.stringify(keys))
    if (!sameKeys) await collection.createIndex(keys, options)
  }

  console.log(`Phase 6 migration completed: ${specs.length} measured-query indexes ensured.`)
  await mongoose.disconnect()
}

run().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
