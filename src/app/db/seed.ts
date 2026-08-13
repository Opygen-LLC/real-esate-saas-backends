import mongoose from 'mongoose'
import config from '../../config'
import { SubscriptionPlanService } from '../module/subscriptionPlan/subscriptionPlan.service'

/**
 * Production-safe bootstrap for a fresh database.
 *
 * This intentionally does not create demo tenants/users/listings and never deletes data.
 * Existing installations must use the explicit migration scripts instead of reseeding.
 */
const seedDatabase = async (): Promise<void> => {
  if (config.isProduction && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
    throw new Error('Production seeding is disabled. Set ALLOW_PRODUCTION_SEED=true only for an approved fresh-database bootstrap.')
  }

  await mongoose.connect(config.database_string, {
    maxPoolSize: config.mongo.max_pool_size,
    minPoolSize: config.mongo.min_pool_size,
    serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
    connectTimeoutMS: config.mongo.connect_timeout_ms,
    socketTimeoutMS: config.mongo.socket_timeout_ms,
    waitQueueTimeoutMS: config.mongo.wait_queue_timeout_ms,
  })

  try {
    const plans = await SubscriptionPlanService.getAllPlans()
    console.log(`Database bootstrap complete. ${plans.length} current BDT subscription plan(s) are available.`)
  } finally {
    await mongoose.disconnect()
  }
}

seedDatabase().catch(async (error: unknown) => {
  console.error('Database bootstrap failed:', error instanceof Error ? error.message : error)
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
