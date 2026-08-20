import mongoose from 'mongoose'
import config from '../../config'
import { RedisClient } from '../../shared/redisClient'
import { SubscriptionBenefitPeriod } from '../module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.model'
import { migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'subscription-benefit-period-ledger-v1'

const run = async (): Promise<void> => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  const collection = mongoose.connection.collection('subscriptionbenefitperiods')
  const existingCount = await collection.countDocuments({}).catch(() => 0)
  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} existingPeriods=${existingCount}`)
  console.log(`[${MIGRATION}] This migration is create-only. It does not synthesize historical allowances from legacy payments.`)

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No database changes made. Re-run with --apply to create the ledger indexes.`)
    return
  }

  await SubscriptionBenefitPeriod.createIndexes()
  const indexes = await collection.indexes()
  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    existingPeriodsBefore: existingCount,
    dataPolicy: 'No legacy benefit periods are fabricated. Phase 10 records are created atomically from confirmed paid subscription activations going forward.',
    indexes: indexes.map((index: any) => ({ name: index.name, key: index.key, unique: Boolean(index.unique) })),
  })
  console.log(`[${MIGRATION}] completed indexes=${indexes.length} manifest=${manifest}`)
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    RedisClient.close()
    await mongoose.disconnect().catch(() => undefined)
  })
