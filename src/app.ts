import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { Application, NextFunction, Request, Response } from 'express'
import helmet from 'helmet'
import httpStatus from 'http-status'
import mongoose from 'mongoose'
import { CronRoute } from './app/module/cron/cron.route'
import globalErrorHandler from './app/middlewares/globalErrorHandler'
import routes from './app/routes/index'
import { sendResponse } from './shared/customResponse'
import config from './config'
import { csrfProtection, requestContext, verifyCronSignature } from './app/middlewares/security'
import { Metrics } from './shared/metrics'
import { RedisClient } from './shared/redisClient'
import { logger } from './shared/logger'
import { getWorkerHealth } from './app/module/cron/phase3.worker'
import { mongoSupportsTransactions } from './app/db/mongoCapabilities'
import { emailProviderStatus, verifyEmailProvider } from './app/helpers/sendEmail'

const app: Application = express()
const startedAt = Date.now()

app.disable('x-powered-by')
app.set('trust proxy', 1)

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    const normalizedOrigin = origin.replace(/\/$/, '')
    return callback(null, config.allowed_origins.includes(normalizedOrigin))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-CSRF-Token', 'X-Request-ID', 'Idempotency-Key', 'traceparent'],
  exposedHeaders: ['X-Request-ID', 'traceparent', 'Server-Timing'],
  maxAge: 86400,
}
app.use(cors(corsOptions))
app.options('*', cors(corsOptions) as any)

app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  hsts: config.isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
}))
app.use(requestContext)
app.use((req: Request, res: Response, next: NextFunction) => {
  const started = performance.now()
  res.on('finish', () => {
    const durationMs = performance.now() - started
    Metrics.observeHttp({ method: req.method, path: req.originalUrl, statusCode: res.statusCode, durationMs })
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'
    logger.log(level, 'http_request', {
      method: req.method,
      path: Metrics.normalizeRoute(req.path),
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      ip: req.ip,
      organizationId: req.tenant?.organizationId,
    })
  })
  next()
})
app.use(cookieParser())
app.use('/api/v1/organization/website', express.json({ limit: '5mb' }))
app.use('/api/v1/lead/import', express.json({ limit: '6mb' }))
app.use('/api/v1/observability/client-error', express.json({ limit: '32kb' }))
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '256kb' }))
app.use(csrfProtection)

app.get('/', (_req: Request, res: Response) => {
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Welcome to the Real Estate SaaS API Service', data: { status: 'operational', version: '1.0.0', timestamp: new Date().toISOString() } })
})

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()), startedAt: new Date(startedAt).toISOString() }))
app.get('/ready', async (_req, res) => {
  const mongo = mongoose.connection.readyState === 1
  const [transactions, redis, email] = await Promise.all([
    mongo ? mongoSupportsTransactions() : Promise.resolve(false),
    RedisClient.ping(),
    verifyEmailProvider(),
  ])
  const worker = getWorkerHealth()
  const workerReady = !config.runtime.worker_enabled || worker.healthy
  const transactionReady = !config.isProduction || transactions
  const emailReady = !config.isProduction || email
  const ready = mongo && transactionReady && redis && emailReady && workerReady
  const emailStatus = emailProviderStatus()
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    dependencies: {
      mongo,
      mongoTransactions: transactions,
      redis: config.redis.enabled ? redis : 'disabled',
      email: { configured: emailStatus.configured, healthy: emailReady, lastCheckedAt: emailStatus.lastCheckedAt },
      worker: config.runtime.worker_enabled ? worker : 'disabled',
    },
  })
})
app.get('/metrics', (req, res) => {
  if (config.isProduction) {
    const token = req.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
    if (!config.observability.metrics_token || token !== config.observability.metrics_token) return res.status(401).type('text/plain').send('unauthorized\n')
  }
  return res.status(200).type('text/plain; version=0.0.4; charset=utf-8').send(Metrics.render())
})

app.use('/api/v1', routes)
app.use('/api/cron', verifyCronSignature, CronRoute)
app.use(globalErrorHandler)

app.all('*', (req: Request, res: Response) => {
  res.status(httpStatus.NOT_FOUND).json({ success: false, message: `No API endpoint found for ${req.method} ${req.originalUrl}`, errorMessages: [{ path: req.originalUrl, message: `No API endpoint found for ${req.method} ${req.originalUrl}` }] })
})

export default app
