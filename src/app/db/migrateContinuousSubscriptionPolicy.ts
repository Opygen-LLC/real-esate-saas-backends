import mongoose from 'mongoose'
import config from '../../config'
import { RedisClient } from '../../shared/redisClient'
import { SubscriptionBenefitPeriod } from '../module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.model'
import { migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'continuous-subscription-policy-v1'

const run = async (): Promise<void> => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  const collection = mongoose.connection.collection('subscriptionbenefitperiods')
  const periodCount = await collection.countDocuments({}).catch(() => 0)
  const existingIndexes = await collection.indexes().catch(() => [])
  const hasConfirmationOrderIndex = existingIndexes.some((index: any) => index.name === 'tenant_continuity_confirmation_order')

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} benefitPeriods=${periodCount} confirmationOrderIndex=${hasConfirmationOrderIndex ? 'present' : 'missing'}`)
  console.log(`[${MIGRATION}] Data rows are not rewritten. Phase 11 changes continuity calculation for future confirmed payments only.`)

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No database changes made. Re-run with --apply to create the confirmation-order index.`)
    return
  }

  await SubscriptionBenefitPeriod.createIndexes()
  const indexes = await collection.indexes()
  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    existingPeriods: periodCount,
    dataPolicy: 'Existing benefit-period snapshots remain immutable. The new continuity policy is evaluated only when a future payment is confirmed.',
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
