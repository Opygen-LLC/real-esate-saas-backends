import { Server } from 'http'
import mongoose from 'mongoose'
import app from './app'
import config from './config'
import { errorLogger, logger } from './shared/logger'
import { mongoSupportsTransactions } from './app/db/mongoCapabilities'
import { startPhase3Worker } from './app/module/cron/phase3.worker'
import { RedisClient } from './shared/redisClient'

let server: Server | undefined
let stopWorker: (() => void) | undefined
let shuttingDown = false

const shutdown = async (reason: string, exitCode = 0): Promise<void> => {
  if (shuttingDown) return
  shuttingDown = true
  logger.info('graceful_shutdown_started', { reason })
  stopWorker?.()

  const force = setTimeout(() => {
    errorLogger.error('graceful_shutdown_timeout', { reason })
    process.exit(exitCode || 1)
  }, config.runtime.shutdown_timeout_ms)
  force.unref()

  try {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
    RedisClient.close()
    await mongoose.disconnect()
    clearTimeout(force)
    logger.info('graceful_shutdown_complete', { reason })
    process.exitCode = exitCode
  } catch (error) {
    clearTimeout(force)
    errorLogger.error('graceful_shutdown_failed', { reason, error })
    process.exitCode = 1
  }
}

process.on('uncaughtException', (error) => { errorLogger.error('uncaught_exception', { error }); void shutdown('uncaughtException', 1) })
process.on('unhandledRejection', (error) => { errorLogger.error('unhandled_rejection', { error }); void shutdown('unhandledRejection', 1) })
process.on('SIGTERM', () => { void shutdown('SIGTERM') })
process.on('SIGINT', () => { void shutdown('SIGINT') })

async function bootstrap() {
  try {
    ;(mongoose as any).set('maxTimeMS', config.mongo.query_timeout_ms)
    await mongoose.connect(config.database_string, {
      autoIndex: !config.isProduction,
      maxPoolSize: config.mongo.max_pool_size,
      minPoolSize: config.mongo.min_pool_size,
      serverSelectionTimeoutMS: config.mongo.server_selection_timeout_ms,
      connectTimeoutMS: config.mongo.connect_timeout_ms,
      socketTimeoutMS: config.mongo.socket_timeout_ms,
      waitQueueTimeoutMS: config.mongo.wait_queue_timeout_ms,
    })
    logger.info('database_connected', { maxPoolSize: config.mongo.max_pool_size, minPoolSize: config.mongo.min_pool_size })
    const transactionReady = await mongoSupportsTransactions()
    if (!transactionReady && config.isProduction) throw new Error('Production requires a MongoDB replica set or mongos for transactional safety')
    if (transactionReady) logger.info('mongo_transactions_enabled')
    else logger.warn('mongo_standalone_development_mode')

    if (config.redis.enabled && !(await RedisClient.ping())) throw new Error('Redis is enabled but unavailable during startup')
    stopWorker = startPhase3Worker()
    server = app.listen(config.port, () => logger.info('server_listening', { port: config.port, workerEnabled: config.runtime.worker_enabled }))
    server.requestTimeout = 30_000
    server.headersTimeout = 15_000
    server.keepAliveTimeout = 65_000
    server.maxRequestsPerSocket = 1000
  } catch (error) {
    errorLogger.error('startup_failed', { error })
    process.exitCode = 1
    await mongoose.disconnect().catch(() => undefined)
  }
}

void bootstrap()
