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

  const activities = db.collection('activities')
  const name = await ensureIndex(
    activities,
    { organizationId: 1, contactId: 1, createdAt: -1 },
    { name: 'activity_tenant_contact_created' },
  )

  console.log(`CRM Phase 5 history index migration completed successfully (${name}).`)
  await mongoose.disconnect()
}

run().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
