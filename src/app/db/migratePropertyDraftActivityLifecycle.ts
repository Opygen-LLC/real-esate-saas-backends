import mongoose from 'mongoose'
import config from '../../config'
import { backupDocuments, migrationCli, requireConfirmation, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'property-draft-activity-lifecycle'
const CONFIRMATION = 'PHASE5-PROPERTY-DRAFT-ACTIVITY'

const ensureIndex = async (collectionName: string, keys: Record<string, 1 | -1>, name: string) => {
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')
  const collections = await db.listCollections({ name: collectionName }).toArray()
  if (!collections.length) return false
  const collection = db.collection(collectionName)
  const existing = await collection.indexes()
  const conflicting = existing.find((index: any) => index.name === name && JSON.stringify(index.key) !== JSON.stringify(keys))
  if (conflicting?.name) await collection.dropIndex(conflicting.name)
  const refreshed = await collection.indexes()
  if (refreshed.some((index: any) => index.name === name && JSON.stringify(index.key) === JSON.stringify(keys))) return false
  await collection.createIndex(keys, { name })
  return true
}

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

  const hasAssets = (await db.listCollections({ name: 'websiteassets' }).toArray()).length > 0
  const hasIntents = (await db.listCollections({ name: 'websiteuploadintents' }).toArray()).length > 0
  const assetFilter = { context: 'property-draft', lastReferencedAt: { $exists: false } }
  const intentFilter = { context: 'property-draft', lastReferencedAt: { $exists: false } }
  const assetCount = hasAssets ? await db.collection('websiteassets').countDocuments(assetFilter) : 0
  const intentCount = hasIntents ? await db.collection('websiteuploadintents').countDocuments(intentFilter) : 0

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} assets=${assetCount} intents=${intentCount}`)
  if (!cli.apply) {
    console.log(`[${MIGRATION}] No documents or indexes changed. Use --apply --confirm=${CONFIRMATION} after reviewing this plan.`)
    return
  }

  const backups: Array<{ file: string; count: number; sha256: string }> = []
  if (assetCount) backups.push(await backupDocuments({ collection: db.collection('websiteassets'), filter: assetFilter, migrationName: MIGRATION, backupDir: cli.backupDir }))
  if (intentCount) backups.push(await backupDocuments({ collection: db.collection('websiteuploadintents'), filter: intentFilter, migrationName: MIGRATION, backupDir: cli.backupDir }))

  if (hasAssets) {
    const cursor = db.collection('websiteassets').find(assetFilter, { projection: { _id: 1, createdAt: 1 } })
    for await (const row of cursor) {
      await db.collection('websiteassets').updateOne(
        { _id: row._id, lastReferencedAt: { $exists: false } },
        { $set: { lastReferencedAt: row.createdAt || new Date() } },
      )
    }
  }
  if (hasIntents) {
    const cursor = db.collection('websiteuploadintents').find(intentFilter, { projection: { _id: 1, updatedAt: 1, createdAt: 1 } })
    for await (const row of cursor) {
      await db.collection('websiteuploadintents').updateOne(
        { _id: row._id, lastReferencedAt: { $exists: false } },
        { $set: { lastReferencedAt: row.updatedAt || row.createdAt || new Date() } },
      )
    }
  }

  const indexes: string[] = []
  if (await ensureIndex('websiteassets', { organizationId: 1, context: 1, uploadSessionId: 1, claimed: 1, lastReferencedAt: 1 }, 'property_draft_lifecycle')) indexes.push('websiteassets.property_draft_lifecycle')
  if (await ensureIndex('websiteuploadintents', { organizationId: 1, context: 1, uploadSessionId: 1, lastReferencedAt: 1 }, 'property_draft_intent_lifecycle')) indexes.push('websiteuploadintents.property_draft_intent_lifecycle')

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    migratedAssets: assetCount,
    migratedIntents: intentCount,
    backups: backups.map((item) => ({ file: item.file, count: item.count, sha256: item.sha256 })),
    createdIndexes: indexes,
  })
  console.log(`[${MIGRATION}] completed manifest=${manifest}`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
}).finally(async () => {
  await mongoose.disconnect().catch(() => undefined)
})
