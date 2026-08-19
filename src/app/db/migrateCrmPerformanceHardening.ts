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

  const leads = db.collection('leads')
  const contacts = db.collection('contacts')
  const tasks = db.collection('tasks')
  const activities = db.collection('activities')
  const leadImportSessions = db.collection('lead_import_sessions')

  const indexes = await Promise.all([
    ensureIndex(leads, { organizationId: 1, isConverted: 1, createdAt: -1 }, { name: 'lead_tenant_converted_created' }),
    ensureIndex(leads, { organizationId: 1, assignedAgent: 1, isConverted: 1, followUpDate: 1 }, { name: 'lead_tenant_assignee_converted_followup' }),
    ensureIndex(leads, { organizationId: 1, leadStatus: 1, isConverted: 1, createdAt: -1 }, { name: 'lead_tenant_status_converted_created' }),
    ensureIndex(leads, { organizationId: 1, isConverted: 1, source: 1, createdAt: -1 }, { name: 'lead_tenant_converted_source_created' }),
    ensureIndex(contacts, { organizationId: 1, relationshipState: 1, assignedTo: 1, followUpDate: 1 }, { name: 'contact_tenant_relationship_assignee_followup' }),
    ensureIndex(contacts, { organizationId: 1, relationshipState: 1, source: 1, updatedAt: -1 }, { name: 'contact_tenant_relationship_source_updated' }),
    ensureIndex(contacts, { organizationId: 1, sourceLeadId: 1 }, { name: 'contact_tenant_source_lead_unique', unique: true, partialFilterExpression: { sourceLeadId: { $type: 'objectId' } } }),
    ensureIndex(tasks, { organizationId: 1, taskType: 1, assignedAgent: 1, dueAt: 1 }, { name: 'task_tenant_type_assignee_dueat' }),
    ensureIndex(tasks, { organizationId: 1, linkedLead: 1, taskType: 1, status: 1, dueAt: 1 }, { name: 'task_tenant_lead_type_status_dueat' }),
    ensureIndex(activities, { organizationId: 1, leadId: 1, type: 1, createdAt: -1 }, { name: 'activity_tenant_lead_type_created' }),
    ensureIndex(activities, { organizationId: 1, contactId: 1, type: 1, createdAt: -1 }, { name: 'activity_tenant_contact_type_created' }),
    ensureIndex(leadImportSessions, { organizationId: 1, userId: 1, sessionId: 1 }, { name: 'lead_import_session_owner_unique', unique: true }),
    ensureIndex(leadImportSessions, { expiresAt: 1 }, { name: 'lead_import_session_expiry_ttl', expireAfterSeconds: 0 }),
  ])

  console.log(`CRM performance/index migration completed successfully (${indexes.join(', ')}).`)
  await mongoose.disconnect()
}

run().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
