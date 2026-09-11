import mongoose from 'mongoose'
import { parseGcsReference, redactError } from './common.mjs'

export const walkStrings = (value, path = '', output = []) => {
  if (typeof value === 'string') {
    output.push({ path, value })
    return output
  }
  if (!value || typeof value !== 'object') return output
  if (value instanceof Date || Buffer.isBuffer(value)) return output
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkStrings(entry, path ? `${path}.${index}` : String(index), output))
    return output
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === '_id') continue
    walkStrings(entry, path ? `${path}.${key}` : key, output)
  }
  return output
}

export const connectMigrationDatabase = async () => {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim()
  if (!databaseUrl) throw new Error('DATABASE_URL is required for database reference scanning')
  await mongoose.connect(databaseUrl, {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    appName: 'realestate-r2-migration',
    maxPoolSize: 3,
    minPoolSize: 0,
  })
  if (!mongoose.connection.db) throw new Error('MongoDB connection is not ready')
  return mongoose.connection.db
}

export const closeMigrationDatabase = async () => {
  await mongoose.disconnect().catch(() => undefined)
}

export const scanGcsReferences = async ({
  gcsBuckets,
  knownKeys,
  onReference,
  maxDocuments = 0,
} = {}) => {
  const db = await connectMigrationDatabase()
  const bucketSet = new Set((gcsBuckets || []).filter(Boolean))
  const keySet = knownKeys instanceof Set ? knownKeys : null
  let documentsScanned = 0
  let referencesFound = 0
  const collections = await db.listCollections({}, { nameOnly: true }).toArray()

  try {
    for (const { name } of collections) {
      if (!name || name.startsWith('system.')) continue
      const collection = db.collection(name)
      const cursor = collection.find({}, { batchSize: 100 })
      for await (const document of cursor) {
        documentsScanned += 1
        const stringValues = walkStrings(document)
        for (const entry of stringValues) {
          const parsed = parseGcsReference(entry.value)
          const rawKey = !parsed && keySet?.has(entry.value) ? entry.value : ''
          if (parsed && !bucketSet.has(parsed.bucket)) continue
          if (parsed && keySet && !keySet.has(parsed.key)) continue
          if (!parsed && !rawKey) continue
          referencesFound += 1
          await onReference?.({
            collection: name,
            documentId: String(document._id),
            path: entry.path,
            value: entry.value,
            bucket: parsed?.bucket || '',
            key: parsed?.key || rawKey,
            document,
          })
        }
        if (maxDocuments > 0 && documentsScanned >= maxDocuments) {
          await cursor.close().catch(() => undefined)
          return { documentsScanned, referencesFound, truncated: true }
        }
      }
    }
    return { documentsScanned, referencesFound, truncated: false }
  } catch (error) {
    throw new Error(`Database reference scan failed: ${redactError(error)}`)
  }
}
