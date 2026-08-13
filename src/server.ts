import { Server } from 'http'
import mongoose from 'mongoose'
import app from './app'
import config from './config'
import { errorLogger, logger } from './shared/logger'

let server: Server

process.on('uncaughtException', (error) => {
  errorLogger.error('Uncaught Exception:', error)
  process.exit(1)
})

process.on('unhandledRejection', (error) => {
  errorLogger.error('Unhandled Rejection:', error)
  if (server) {
    server.close(() => {
      process.exit(1)
    })
  } else {
    process.exit(1)
  }
})

process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...')
  if (server) {
    server.close(() => { void mongoose.disconnect() })
  }
})

async function bootstrap() {
  try {
    await mongoose.connect(config.database_string)
    logger.info('Database connected successfully')

    server = app.listen(config.port, () => {
      logger.info(`Real Estate SaaS Server listening on port ${config.port}`)
    })
  } catch (error) {
    errorLogger.error('Error connecting to database:', error)
    process.exitCode = 1
  }
}

bootstrap()
