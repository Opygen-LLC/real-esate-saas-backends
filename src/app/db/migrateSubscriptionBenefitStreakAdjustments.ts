import mongoose from 'mongoose'
import config from '../../config'
import { RedisClient } from '../../shared/redisClient'
import { SubscriptionBenefitStreakAdjustment } from '../module/subscriptionBenefitPeriod/subscriptionBenefitAdjustment.model'
import { migrationCli, writeMigrationManifest } from './migrations/migrationSafety'

const MIGRATION = 'subscription-benefit-streak-adjustments-v1'

const run = async (): Promise<void> => {
  const cli = migrationCli()
  await mongoose.connect(config.database_string, {
    autoIndex: false,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
  })

  const collection = mongoose.connection.collection('subscriptionbenefitstreakadjustments')
  const existingCount = await collection.countDocuments({}).catch(() => 0)
  const existingIndexes = await collection.indexes().catch(() => [])
  const hasAdjustmentOrderIndex = existingIndexes.some((index: any) => index.name === 'tenant_benefit_streak_adjustment_order')

  console.log(`[${MIGRATION}] mode=${cli.apply ? 'APPLY' : 'DRY-RUN'} existingAdjustments=${existingCount} adjustmentOrderIndex=${hasAdjustmentOrderIndex ? 'present' : 'missing'}`)
  console.log(`[${MIGRATION}] Existing benefit-period rows are never rewritten. Support corrections are append-only adjustment records.`)

  if (!cli.apply) {
    console.log(`[${MIGRATION}] No database changes made. Re-run with --apply to create the adjustment indexes.`)
    return
  }

  await SubscriptionBenefitStreakAdjustment.createIndexes()
  const indexes = await collection.indexes()
  const manifest = await writeMigrationManifest(cli.backupDir, MIGRATION, {
    existingAdjustments: existingCount,
    dataPolicy: 'Historical SubscriptionBenefitPeriod rows stay immutable. Renewal-streak support changes are stored as separate append-only records and apply only to future eligible confirmed renewals.',
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
