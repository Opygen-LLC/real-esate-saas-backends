import mongoose from 'mongoose'
import config from '../../config'

const ensureIndex = async (collectionName: string, keys: Record<string, 1 | -1>, name: string) => {
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')
  const collections = await db.listCollections({ name: collectionName }).toArray()
  if (!collections.length) return
  const collection = db.collection(collectionName)
  const existing = await collection.indexes()
  const conflicting = existing.find((index: any) => index.name === name && JSON.stringify(index.key) !== JSON.stringify(keys))
  if (conflicting?.name) await collection.dropIndex(conflicting.name)
  const refreshed = await collection.indexes()
  if (!refreshed.some((index: any) => JSON.stringify(index.key) === JSON.stringify(keys))) await collection.createIndex(keys, { name })
}

const run = async () => {
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  if ((await db.listCollections({ name: 'websiteassets' }).toArray()).length) {
    await db.collection('websiteassets').updateMany(
      { context: { $exists: false } },
      { $set: { context: 'website', claimed: true, uploadSessionId: '' } },
    )
    await db.collection('websiteassets').updateMany(
      { claimed: { $exists: false } },
      { $set: { claimed: true } },
    )
  }

  if ((await db.listCollections({ name: 'websiteuploadintents' }).toArray()).length) {
    await db.collection('websiteuploadintents').updateMany(
      { context: { $exists: false } },
      { $set: { context: 'website', uploadSessionId: '' } },
    )
  }

  await ensureIndex('websiteassets', { organizationId: 1, context: 1, uploadSessionId: 1, claimed: 1, createdAt: 1 }, 'property_draft_lifecycle')
  await ensureIndex('websiteuploadintents', { organizationId: 1, context: 1, uploadSessionId: 1, expiresAt: 1 }, 'property_draft_intent_lifecycle')
  await ensureIndex('websiteassets', { organizationId: 1, claimedByPropertyId: 1 }, 'property_asset_claim')

  console.log('Property draft asset lifecycle migration completed.')
  await mongoose.disconnect()
}

run().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
