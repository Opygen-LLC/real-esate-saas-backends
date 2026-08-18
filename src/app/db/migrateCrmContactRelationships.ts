import mongoose from 'mongoose'
import config from '../../config'

const ensureIndex = async (
  collection: any,
  key: Record<string, 1 | -1>,
  options: Record<string, unknown>,
) => {
  let existing: any[] = []
  try {
    existing = await collection.indexes()
  } catch (error: any) {
    if (error?.code !== 26 && error?.codeName !== 'NamespaceNotFound') throw error
  }

  const sameKey = (left: Record<string, unknown>, right: Record<string, unknown>) =>
    JSON.stringify(left) === JSON.stringify(right)
  const match = existing.find((index: any) => sameKey(index.key, key))
  if (match) return match.name
  return collection.createIndex(key, options)
}

const run = async () => {
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const contacts = db.collection('contacts')
  const activities = db.collection('activities')

  const indexes = await Promise.all([
    ensureIndex(
      contacts,
      { organizationId: 1, relationshipState: 1, assignedTo: 1, convertedAt: -1 },
      { name: 'contact_tenant_relationship_assignee_converted' },
    ),
    ensureIndex(
      contacts,
      { organizationId: 1, relationshipState: 1, statusAtConversion: 1, convertedAt: -1 },
      { name: 'contact_tenant_relationship_status_converted' },
    ),
    ensureIndex(
      activities,
      { organizationId: 1, contactId: 1, createdAt: -1 },
      { name: 'activity_tenant_contact_created' },
    ),
    ensureIndex(
      activities,
      { organizationId: 1, leadId: 1, createdAt: -1 },
      { name: 'activity_tenant_lead_created' },
    ),
  ])

  console.log(`CRM Phase 9 Contact relationship index migration completed successfully (${indexes.join(', ')}).`)
  await mongoose.disconnect()
}

run().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
