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
import { ObjectStorageService } from './app/module/websiteBuilder/objectStorage.service'
import { virusScannerHealth } from './app/module/websiteBuilder/virusScan.service'
import { corsOptionsDelegate } from './app/middlewares/corsPolicy'
import { PrivacyPolicyService } from './app/module/privacy/privacyPolicy.service'
import { authMiddlewares } from './app/middlewares/auth'

const app: Application = express()
const startedAt = Date.now()

app.disable('x-powered-by')
app.set('trust proxy', 1)

app.use(cors(corsOptionsDelegate))
app.options('*', cors(corsOptionsDelegate) as any)

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
      path: req.originalUrl || req.path,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
    })

  })
  next()
})
app.use(cookieParser())
app.use(authMiddlewares.enforceImpersonationReadOnly)
app.use('/api/v1/organization/website', express.json({ limit: '5mb' }))
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
  const [transactions, redis, email, objectStorage, clamav, privacy] = await Promise.all([
    mongo ? mongoSupportsTransactions() : Promise.resolve(false),
    RedisClient.ping(),
    verifyEmailProvider(),
    ObjectStorageService.health(),
    virusScannerHealth(),
    mongo ? PrivacyPolicyService.getPublicPolicyState() : Promise.resolve({ ready: false, policyUrl: '', policyVersion: '', legalReviewStatus: 'required' as const }),
  ])
  const worker = getWorkerHealth()
  const workerReady = !config.runtime.worker_enabled || worker.healthy
  const transactionReady = !config.isProduction || transactions
  const emailReady = !config.isProduction || email
  const mediaReady = !config.isProduction || (objectStorage.healthy && clamav.healthy)
  const privacyReady = !config.isProduction || privacy.ready
  const ready = mongo && transactionReady && redis && emailReady && workerReady && mediaReady && privacyReady
  const emailStatus = emailProviderStatus()
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    dependencies: {
      mongo,
      mongoTransactions: transactions,
      redis: config.redis.enabled ? redis : 'disabled',
      email: { configured: emailStatus.configured, healthy: emailReady, lastCheckedAt: emailStatus.lastCheckedAt },
      worker: config.runtime.worker_enabled ? worker : 'disabled',
      objectStorage,
      clamav,
      privacy: { ...privacy, healthy: privacyReady },
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

import { UploadRoute } from './app/module/upload/upload.route'

app.use('/api/v1', routes)
app.use('/api/upload', UploadRoute)
app.use('/upload', UploadRoute)
app.use('/api/cron', verifyCronSignature, CronRoute)

app.use(globalErrorHandler)

app.all('*', (req: Request, res: Response) => {
  const message = `No API endpoint found for ${req.method} ${req.originalUrl}`
  res.status(httpStatus.NOT_FOUND).json({
    success: false,
    code: 'NOT_FOUND',
    message,
    fieldErrors: {},
    errorMessages: [{ path: req.originalUrl, message }],
    requestId: req.requestId,
  })
})

export default app
