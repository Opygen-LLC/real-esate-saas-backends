import mongoose from 'mongoose'
import config from '../../config'
import { migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'registration-continuation-token-v1'

const run = async () => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is not available')

  const collection = db.collection('otpchallenges')
  const indexName = 'otp_challenge_continuation_token_unique'
  const existingIndexes = await collection.indexes().catch((error: any) => {
    if (error?.code === 26 || error?.codeName === 'NamespaceNotFound') return []
    throw error
  })
  const existing = existingIndexes.find((index: any) => index.name === indexName)

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} index=${indexName} existing=${Boolean(existing)}`)
  if (!cli.apply) {
    console.log(`[${MIGRATION}] No indexes changed. Use --apply after reviewing this plan.`)
    return
  }

  await collection.updateMany(
    { continuationTokenHash: '' },
    { $unset: { continuationTokenHash: '' } },
  )

  if (!existing) {
    await collection.createIndex(
      { continuationTokenHash: 1 },
      { unique: true, sparse: true, name: indexName },
    )
  }

  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    appliedIndexes: [existing ? `${indexName}:already-present` : indexName],
  })
  console.log(`[${MIGRATION}] completed manifest=${manifest}`)
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined) })
